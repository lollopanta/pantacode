/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICodeStructureService, FileStructureSnapshot } from '../../codeStructure/common/codeStructure.js';
import { CodeHistoryEvent, HistoryEventKind, ICodeHistoryService, SnapshotRef } from '../common/codeHistory.js';

let NEXT_EVENT_ID = 1;

interface PerFileHistory {
	readonly uri: URI;
	events: CodeHistoryEvent[];
	lastSnapshot?: FileStructureSnapshot;
}

/**
 * Lightweight, in-memory implementation of {@link ICodeHistoryService}.
 *
 * For now this listens to structural snapshot updates and records
 * symbol-level added/removed/changed events whenever a file stabilises.
 * Persistence and integration with the timeline UI are added separately.
 */
export class CodeHistoryService extends Disposable implements ICodeHistoryService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidRecordEvent = this._register(new Emitter<CodeHistoryEvent>());
	readonly onDidRecordEvent: Event<CodeHistoryEvent> = this._onDidRecordEvent.event;

	private readonly _perFile = new Map<string, PerFileHistory>();

	constructor(
		@ICodeStructureService private readonly codeStructureService: ICodeStructureService,
		@IModelService private readonly modelService: IModelService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(this.codeStructureService.onDidUpdateSnapshot(uri => this.onSnapshotUpdated(uri)));
		this._register(this.modelService.onModelRemoved(model => this.onModelRemoved(model)));
	}

	getEventsForFile(uri: URI): readonly CodeHistoryEvent[] {
		return this._perFile.get(uri.toString())?.events ?? [];
	}

	getEventsForSymbol(symbolId: string): readonly CodeHistoryEvent[] {
		const result: CodeHistoryEvent[] = [];
		for (const history of this._perFile.values()) {
			for (const event of history.events) {
				if (event.symbolId === symbolId) {
					result.push(event);
				}
			}
		}
		return result;
	}

	getSnapshotAt(event: CodeHistoryEvent): FileStructureSnapshot | undefined {
		return this.codeStructureService.getSnapshot(event.uri);
	}

	private onSnapshotUpdated(uri: URI): void {
		const model = this.modelService.getModel(uri);
		if (!model) {
			return;
		}

		const snapshot = this.codeStructureService.getSnapshot(uri);
		if (!snapshot) {
			return;
		}

		try {
			const key = uri.toString();
			let history = this._perFile.get(key);
			if (!history) {
				history = { uri, events: [], lastSnapshot: undefined };
				this._perFile.set(key, history);
			}

			const previousSnapshot = history.lastSnapshot;
			history.lastSnapshot = snapshot;

			if (!previousSnapshot) {
				// First snapshot: treat as baseline without events.
				return;
			}

			const events = this.computeDiffEvents(previousSnapshot, snapshot);
			for (const event of events) {
				history.events.push(event);
				this._onDidRecordEvent.fire(event);
			}
		} catch (error) {
			this.logService.debug('[CodeHistoryService] Failed to record history for', uri.toString(), error);
		}
	}

	private onModelRemoved(model: ITextModel): void {
		// Do not drop history; keep it for the life of the workspace.
		const key = model.uri.toString();
		const existing = this._perFile.get(key);
		if (existing) {
			existing.lastSnapshot = undefined;
		}
	}

	private computeDiffEvents(previous: FileStructureSnapshot, next: FileStructureSnapshot): CodeHistoryEvent[] {
		const prevById = new Map<string, { name: string }>();
		for (const symbol of previous.symbols) {
			prevById.set(symbol.id, { name: symbol.name });
		}

		const nextById = new Map<string, { name: string }>();
		for (const symbol of next.symbols) {
			nextById.set(symbol.id, { name: symbol.name });
		}

		const events: CodeHistoryEvent[] = [];

		const snapshotRef: SnapshotRef = {
			uri: next.uri,
			version: next.version
		};

		for (const [id, prevInfo] of prevById) {
			if (!nextById.has(id)) {
				events.push(this.createEvent(next.uri, id, HistoryEventKind.SymbolRemoved, `Removed symbol ${prevInfo.name}`, snapshotRef));
			}
		}

		for (const [id, nextInfo] of nextById) {
			const prevInfo = prevById.get(id);
			if (!prevInfo) {
				events.push(this.createEvent(next.uri, id, HistoryEventKind.SymbolAdded, `Added symbol ${nextInfo.name}`, snapshotRef));
			} else if (prevInfo.name !== nextInfo.name) {
				events.push(this.createEvent(next.uri, id, HistoryEventKind.SymbolChanged, `Renamed symbol ${prevInfo.name} → ${nextInfo.name}`, snapshotRef));
			}
		}

		return events;
	}

	private createEvent(uri: URI, symbolId: string | undefined, kind: HistoryEventKind, summary: string, snapshot: SnapshotRef): CodeHistoryEvent {
		return {
			id: String(NEXT_EVENT_ID++),
			uri,
			symbolId,
			kind,
			timestamp: Date.now(),
			summary,
			snapshot
		};
	}
}

registerSingleton(ICodeHistoryService, CodeHistoryService, InstantiationType.Delayed);

