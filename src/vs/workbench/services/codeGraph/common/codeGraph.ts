/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { FileStructureSnapshot, SymbolNodeLite } from '../../codeStructure/common/codeStructure.js';

export const ICodeGraphService = createDecorator<ICodeGraphService>('codeGraphService');

export const enum GraphEdgeKind {
	Call = 0,
	Import = 1,
	Export = 2
}

export interface GraphEdge {
	readonly from: string; // SymbolNodeLite.id of caller / source
	readonly to: string; // SymbolNodeLite.id of callee / target
	readonly kind: GraphEdgeKind;
}

export interface ICodeGraphService {
	readonly _serviceBrand: undefined;

	readonly onDidUpdateGraphForUri: Event<URI>;

	/**
	 * Returns the last known structural snapshot for the given file, if any.
	 * This simply proxies {@link ICodeStructureService} for convenience.
	 */
	getSnapshot(uri: URI): FileStructureSnapshot | undefined;

	/**
	 * All edges originating from the given symbol.
	 */
	getCallees(symbolId: string): readonly GraphEdge[];

	/**
	 * All edges targeting the given symbol.
	 */
	getCallers(symbolId: string): readonly GraphEdge[];

	/**
	 * All edges associated with a given file.
	 */
	getEdgesForFile(uri: URI): readonly GraphEdge[];

	/**
	 * Rough approximation of exported symbols of a file.
	 * For the initial implementation this focuses on top-level
	 * functions, classes and methods.
	 */
	getExportedSymbols(uri: URI): readonly SymbolNodeLite[];

	/**
	 * Returns URIs that this file seems to import from.
	 * The initial implementation may return an empty array
	 * or URIs that are not fully resolved.
	 */
	getImportsOfFile(uri: URI): readonly URI[];
}

