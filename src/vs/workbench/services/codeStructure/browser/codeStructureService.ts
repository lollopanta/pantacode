/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRange } from '../../../../base/common/range.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CodeSymbolKind, FileStructureSnapshot, ICodeStructureService, SymbolNodeLite } from '../common/codeStructure.js';

/**
 * Browser-side implementation of {@link ICodeStructureService}.
 *
 * For the MVP we use a best-effort, regex-based extractor for JS/TS symbols.
 * This keeps us independent from TS Server wiring while still providing
 * useful structural information to higher level services.
 */
export class CodeStructureService extends Disposable implements ICodeStructureService {

	declare readonly _serviceBrand: undefined;

	private static readonly RECOMPUTE_DELAY = 250;

	private readonly _onDidUpdateSnapshot = this._register(new Emitter<URI>());
	readonly onDidUpdateSnapshot: Event<URI> = this._onDidUpdateSnapshot.event;

	private readonly _snapshots = new Map<string, FileStructureSnapshot>();
	private readonly _recomputeSchedulers = new Map<string, RunOnceScheduler>();

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.modelService.onModelAdded(model => this.onModelAdded(model)));
		this._register(this.modelService.onModelRemoved(model => this.onModelRemoved(model)));

		for (const model of this.modelService.getModels()) {
			this.onModelAdded(model);
		}
	}

	private isSupported(model: ITextModel): boolean {
		const languageId = model.getLanguageId();
		return languageId === 'typescript'
			|| languageId === 'typescriptreact'
			|| languageId === 'javascript'
			|| languageId === 'javascriptreact';
	}

	private onModelAdded(model: ITextModel): void {
		if (!this.isSupported(model)) {
			return;
		}

		const key = model.uri.toString();

		let scheduler = this._recomputeSchedulers.get(key);
		if (!scheduler) {
			scheduler = new RunOnceScheduler(() => this.recomputeSnapshot(model), CodeStructureService.RECOMPUTE_DELAY);
			this._recomputeSchedulers.set(key, scheduler);
			this._register(scheduler);
		}

		this._register(model.onDidChangeContent(() => {
			if (!this.isSupported(model)) {
				return;
			}

			scheduler?.schedule();
		}));

		this._register(model.onWillDispose(() => {
			this._recomputeSchedulers.delete(key);
			this._snapshots.delete(key);
		}));

		// Initial snapshot
		scheduler.schedule();
	}

	private onModelRemoved(model: ITextModel): void {
		const key = model.uri.toString();
		this._recomputeSchedulers.get(key)?.dispose();
		this._recomputeSchedulers.delete(key);
	}

	getSnapshot(uri: URI, _versionHint?: number): FileStructureSnapshot | undefined {
		return this._snapshots.get(uri.toString());
	}

	getSymbolAtPosition(uri: URI, position: Position): SymbolNodeLite | undefined {
		const snapshot = this.getSnapshot(uri);
		if (!snapshot) {
			return undefined;
		}

		for (const symbol of snapshot.symbols) {
			if (this.containsPosition(symbol.range, position)) {
				return symbol;
			}
		}

		return undefined;
	}

	private containsPosition(range: IRange, position: Position): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
			return false;
		}
		if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
			return false;
		}
		return true;
	}

	private recomputeSnapshot(model: ITextModel): void {
		try {
			const snapshot = this.buildSnapshot(model);
			const key = model.uri.toString();

			this._snapshots.set(key, snapshot);
			this._onDidUpdateSnapshot.fire(model.uri);
		} catch (error) {
			this.logService.debug('[CodeStructureService] Failed to compute snapshot', model.uri.toString(), error);
		}
	}

	private buildSnapshot(model: ITextModel): FileStructureSnapshot {
		const uri = model.uri;
		const languageId = model.getLanguageId();
		const version = model.getVersionId();

		const text = model.getValue();
		const lines = text.split(/\r\n|\r|\n/);

		const symbols: SymbolNodeLite[] = [];

		let currentClassId: string | undefined;

		for (let i = 0; i < lines.length; i++) {
			const lineNumber = i + 1;
			const line = lines[i];

			const classMatch = /^\s*(export\s+)?(abstract\s+)?class\s+([A-Za-z0-9_$]+)/.exec(line);
			if (classMatch) {
				const name = classMatch[3];
				const nameColumn = line.indexOf(name) + 1;
				const range = new Range(lineNumber, nameColumn, lineNumber, nameColumn + name.length);
				const id = this.buildSymbolId(uri, name, lineNumber);

				const symbol: SymbolNodeLite = {
					id,
					name,
					kind: CodeSymbolKind.Class,
					uri,
					range,
					selectionRange: range,
					metrics: undefined
				};

				symbols.push(symbol);
				currentClassId = id;
				continue;
			}

			const functionMatch = /^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(line);
			if (functionMatch) {
				const name = functionMatch[3];
				const nameColumn = line.indexOf(name) + 1;
				const range = new Range(lineNumber, nameColumn, lineNumber, nameColumn + name.length);
				const id = this.buildSymbolId(uri, name, lineNumber);

				const symbol: SymbolNodeLite = {
					id,
					name,
					kind: CodeSymbolKind.Function,
					uri,
					range,
					selectionRange: range,
					containerId: undefined,
					metrics: undefined
				};

				symbols.push(symbol);
				continue;
			}

			// Very naive method syntax inside classes: foo() { ... }
			const methodMatch = /^\s*(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?([A-Za-z0-9_$]+)\s*\(/.exec(line);
			if (methodMatch && currentClassId) {
				const name = methodMatch[4];
				const nameColumn = line.indexOf(name) + 1;
				const range = new Range(lineNumber, nameColumn, lineNumber, nameColumn + name.length);
				const id = this.buildSymbolId(uri, `${name}@${currentClassId}`, lineNumber);

				const symbol: SymbolNodeLite = {
					id,
					name,
					kind: CodeSymbolKind.Method,
					uri,
					range,
					selectionRange: range,
					containerId: currentClassId,
					metrics: undefined
				};

				symbols.push(symbol);
				continue;
			}

			// reset current class when we hit an empty line that is less indented
			if (/^\s*$/.test(line)) {
				currentClassId = undefined;
			}
		}

		const fileSymbol: SymbolNodeLite = {
			id: this.buildSymbolId(uri, '<file>', 1),
			name: basename(uri),
			kind: CodeSymbolKind.File,
			uri,
			range: new Range(1, 1, Math.max(1, lines.length), lines[lines.length - 1]?.length + 1 || 1),
			selectionRange: new Range(1, 1, 1, 1),
			metrics: {
				loc: lines.length
			}
		};

		symbols.unshift(fileSymbol);

		return {
			uri,
			version,
			languageId,
			symbols,
			createdAt: Date.now()
		};
	}

	private buildSymbolId(uri: URI, name: string, lineNumber: number): string {
		return `${uri.toString()}::${name}@${lineNumber}`;
	}
}

registerSingleton(ICodeStructureService, CodeStructureService, InstantiationType.Delayed);

