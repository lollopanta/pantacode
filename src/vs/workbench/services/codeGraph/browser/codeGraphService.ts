/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { escapeRegExpCharacters } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICodeStructureService, SymbolNodeLite, CodeSymbolKind } from '../../codeStructure/common/codeStructure.js';
import { GraphEdge, GraphEdgeKind, ICodeGraphService } from '../common/codeGraph.js';

const MAX_FILE_LENGTH_FOR_SCAN = 200_000; // characters

interface FileGraphData {
	readonly uri: URI;
	readonly edges: GraphEdge[];
}

/**
 * In-memory implementation of {@link ICodeGraphService}.
 *
 * For the initial version this service only computes *intra-file* call
 * relationships for JS/TS files using a best-effort text search. It is
 * designed so that cross-file edges and imports/exports can be added later
 * without changing the public surface.
 */
export class CodeGraphService extends Disposable implements ICodeGraphService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidUpdateGraphForUri = this._register(new Emitter<URI>());
	readonly onDidUpdateGraphForUri: Event<URI> = this._onDidUpdateGraphForUri.event;

	private readonly _fileGraphs = new Map<string, FileGraphData>();

	private readonly _outgoingEdges = new Map<string, GraphEdge[]>();
	private readonly _incomingEdges = new Map<string, GraphEdge[]>();
	private readonly _symbolToFile = new Map<string, string>();

	constructor(
		@ICodeStructureService private readonly codeStructureService: ICodeStructureService,
		@IModelService private readonly modelService: IModelService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(this.codeStructureService.onDidUpdateSnapshot(uri => this.rebuildForUri(uri)));
	}

	getSnapshot(uri: URI) {
		return this.codeStructureService.getSnapshot(uri);
	}

	getCallees(symbolId: string): readonly GraphEdge[] {
		return this._outgoingEdges.get(symbolId) ?? [];
	}

	getCallers(symbolId: string): readonly GraphEdge[] {
		return this._incomingEdges.get(symbolId) ?? [];
	}

	getEdgesForFile(uri: URI): readonly GraphEdge[] {
		return this._fileGraphs.get(uri.toString())?.edges ?? [];
	}

	getExportedSymbols(uri: URI): readonly SymbolNodeLite[] {
		const snapshot = this.codeStructureService.getSnapshot(uri);
		if (!snapshot) {
			return [];
		}

		// For now treat all top-level, non-file symbols as exported.
		return snapshot.symbols.filter(symbol =>
			symbol.kind !== CodeSymbolKind.File &&
			!symbol.containerId
		);
	}

	getImportsOfFile(_uri: URI): readonly URI[] {
		// Imports are not yet modelled in the initial implementation.
		return [];
	}

	private rebuildForUri(uri: URI): void {
		const snapshot = this.codeStructureService.getSnapshot(uri);
		if (!snapshot) {
			return;
		}

		const model = this.modelService.getModel(uri);
		if (!model) {
			return;
		}

		if (model.getValueLength() > MAX_FILE_LENGTH_FOR_SCAN) {
			this.logService.debug('[CodeGraphService] Skipping graph rebuild for large file', uri.toString());
			return;
		}

		try {
			const fileKey = uri.toString();
			const oldFileGraph = this._fileGraphs.get(fileKey);
			if (oldFileGraph) {
				this.removeEdges(oldFileGraph.edges);
			}

			const newEdges = this.computeIntraFileCallEdges(snapshot, model);
			this._fileGraphs.set(fileKey, { uri, edges: newEdges });
			this.addEdges(newEdges);

			for (const symbol of snapshot.symbols) {
				this._symbolToFile.set(symbol.id, fileKey);
			}

			this._onDidUpdateGraphForUri.fire(uri);
		} catch (error) {
			this.logService.debug('[CodeGraphService] Failed to rebuild graph for', uri.toString(), error);
		}
	}

	private computeIntraFileCallEdges(snapshot: { symbols: readonly SymbolNodeLite[] }, model: ITextModel): GraphEdge[] {
		const text = model.getValue();
		const symbols = snapshot.symbols;

		const fileSymbol = symbols.find(s => s.kind === CodeSymbolKind.File);
		const symbolByName = new Map<string, SymbolNodeLite[]>();
		for (const symbol of symbols) {
			if (symbol.kind === CodeSymbolKind.Function || symbol.kind === CodeSymbolKind.Method) {
				const list = symbolByName.get(symbol.name) ?? [];
				list.push(symbol);
				symbolByName.set(symbol.name, list);
			}
		}

		const edges: GraphEdge[] = [];
		const seen = new Set<string>();

		for (const [name, candidates] of symbolByName) {
			const regex = new RegExp(`\\b${escapeRegExpCharacters(name)}\\s*\\(`, 'g');

			while (true) {
				const match = regex.exec(text);
				if (!match) {
					break;
				}

				const offset = match.index;
				const position = model.getPositionAt(offset);

				const fromSymbol = this.findContainingSymbol(symbols, position) ?? fileSymbol;
				if (!fromSymbol) {
					continue;
				}

				for (const target of candidates) {
					const key = `${fromSymbol.id}->${target.id}`;
					if (seen.has(key)) {
						continue;
					}
					seen.add(key);

					const edge: GraphEdge = {
						from: fromSymbol.id,
						to: target.id,
						kind: GraphEdgeKind.Call
					};
					edges.push(edge);
				}
			}
		}

		return edges;
	}

	private findContainingSymbol(symbols: readonly SymbolNodeLite[], position: { lineNumber: number; column: number }): SymbolNodeLite | undefined {
		for (const symbol of symbols) {
			const range = symbol.range;
			if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
				continue;
			}
			if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
				continue;
			}
			if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
				continue;
			}

			if (symbol.kind !== CodeSymbolKind.File) {
				return symbol;
			}
		}

		return undefined;
	}

	private addEdges(edges: readonly GraphEdge[]): void {
		for (const edge of edges) {
			const outgoing = this._outgoingEdges.get(edge.from) ?? [];
			outgoing.push(edge);
			this._outgoingEdges.set(edge.from, outgoing);

			const incoming = this._incomingEdges.get(edge.to) ?? [];
			incoming.push(edge);
			this._incomingEdges.set(edge.to, incoming);
		}
	}

	private removeEdges(edges: readonly GraphEdge[]): void {
		for (const edge of edges) {
			const outgoing = this._outgoingEdges.get(edge.from);
			if (outgoing) {
				this._outgoingEdges.set(edge.from, outgoing.filter(e => e !== edge));
			}

			const incoming = this._incomingEdges.get(edge.to);
			if (incoming) {
				this._incomingEdges.set(edge.to, incoming.filter(e => e !== edge));
			}
		}
	}
}

registerSingleton(ICodeGraphService, CodeGraphService, InstantiationType.Delayed);

