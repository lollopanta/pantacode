/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IRange } from '../../../../base/common/range.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ICodeStructureService = createDecorator<ICodeStructureService>('codeStructureService');

/**
 * Lightweight symbol kind classification for structural reasoning.
 * This is intentionally coarse and JS/TS focused for the initial MVP.
 */
export const enum CodeSymbolKind {
	File = 0,
	Class = 1,
	Method = 2,
	Function = 3,
	Property = 4,
	Variable = 5,
	Unknown = 6
}

/**
 * Lightweight per-symbol structural information.
 * Edges and cross-file relationships are owned by the CodeGraphService.
 */
export interface SymbolNodeLite {
	readonly id: string; // stable within a workspace for a given declaration
	readonly name: string;
	readonly kind: CodeSymbolKind;

	readonly uri: URI;
	readonly range: IRange;
	readonly selectionRange: IRange;

	readonly containerId?: string;

	/**
	 * Very small doc/summary, e.g. first JSDoc line.
	 */
	readonly jsDocSummary?: string;

	/**
	 * Cheap structural metrics used by higher level services.
	 */
	readonly metrics?: {
		readonly loc: number;
		readonly complexity?: number;
	};
}

export interface FileStructureSnapshot {
	readonly uri: URI;
	readonly version: number;
	readonly languageId: string;

	readonly symbols: readonly SymbolNodeLite[];

	/**
	 * Timestamp when this snapshot was produced.
	 * Mainly for debugging / history attribution.
	 */
	readonly createdAt: number;
}

export interface ICodeStructureService {
	readonly _serviceBrand: undefined;

	/**
	 * Fired whenever the structural snapshot for a given URI is updated.
	 */
	readonly onDidUpdateSnapshot: Event<URI>;

	/**
	 * Return the latest known snapshot for the given file, if any.
	 *
	 * The optional `versionHint` can be used by implementations to avoid
	 * recomputing a snapshot if they already have data for that version,
	 * but callers should not rely on it for correctness.
	 */
	getSnapshot(uri: URI, versionHint?: number): FileStructureSnapshot | undefined;

	/**
	 * Resolve the lightweight symbol at the given position, if any.
	 */
	getSymbolAtPosition(uri: URI, position: Position): SymbolNodeLite | undefined;
}

