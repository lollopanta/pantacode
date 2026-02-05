/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { FileStructureSnapshot } from '../../codeStructure/common/codeStructure.js';

export const ICodeHistoryService = createDecorator<ICodeHistoryService>('codeHistoryService');

export const enum HistoryEventKind {
	SymbolAdded = 0,
	SymbolRemoved = 1,
	SymbolChanged = 2
}

export interface SnapshotRef {
	readonly uri: URI;
	readonly version: number;
}

export interface CodeHistoryEvent {
	readonly id: string;
	readonly uri: URI;
	readonly symbolId?: string;
	readonly kind: HistoryEventKind;
	readonly timestamp: number;
	readonly summary: string;
	readonly snapshot: SnapshotRef;
}

export interface ICodeHistoryService {
	readonly _serviceBrand: undefined;

	readonly onDidRecordEvent: Event<CodeHistoryEvent>;

	/**
	 * Returns events ordered by time for a given file.
	 */
	getEventsForFile(uri: URI): readonly CodeHistoryEvent[];

	/**
	 * Returns events ordered by time for a given symbol.
	 */
	getEventsForSymbol(symbolId: string): readonly CodeHistoryEvent[];

	/**
	 * Returns the snapshot associated with the given event, if still available.
	 * This simply proxies the underlying structure service.
	 */
	getSnapshotAt(event: CodeHistoryEvent): FileStructureSnapshot | undefined;
}

