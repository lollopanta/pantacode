/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor, IEditorContribution } from '../../../browser/editorBrowser.js';
import { IModelDeltaDecoration, ITextModel, TrackedRangeStickiness } from '../../../common/model.js';
import { Range } from '../../../common/core/range.js';
import { IEditorDecorationsCollection } from '../../../common/editorCommon.js';
import { ICodeHistoryService } from '../../../../workbench/services/codeHistory/common/codeHistory.js';
import { ICodeGraphService } from '../../../../workbench/services/codeGraph/common/codeGraph.js';

const LIVING_CODE_ID = 'editor.contrib.livingCode';

export class LivingCodeController extends Disposable implements IEditorContribution {

	static readonly ID = LIVING_CODE_ID;

	static get(editor: ICodeEditor): LivingCodeController | undefined {
		return editor.getContribution<LivingCodeController>(LivingCodeController.ID);
	}

	private readonly store = new DisposableStore();
	private decorations?: IEditorDecorationsCollection;

	constructor(
		private readonly editor: ICodeEditor,
		@ICodeHistoryService private readonly historyService: ICodeHistoryService,
		@ICodeGraphService private readonly graphService: ICodeGraphService
	) {
		super();

		this.registerListeners();
	}

	override dispose(): void {
		this.store.dispose();
		this.decorations?.clear();
		super.dispose();
	}

	private registerListeners(): void {
		this.store.add(this.editor.onDidChangeModel(() => this.refresh()));
		this.store.add(this.editor.onDidChangeModelContent(() => this.refresh()));

		this.refresh();
	}

	private refresh(): void {
		const model = this.editor.getModel();
		if (!model) {
			this.decorations?.clear();
			return;
		}

		const uri = model.uri as URI;
		const historyEvents = this.historyService.getEventsForFile(uri);

		const recent = historyEvents.slice(-5);
		const decorations: IModelDeltaDecoration[] = [];

		for (const event of recent) {
			if (!event.symbolId) {
				continue;
			}
			const snapshot = this.graphService.getSnapshot(uri);
			const symbol = snapshot?.symbols.find(s => s.id === event.symbolId);
			if (!symbol) {
				continue;
			}

			decorations.push({
				range: symbol.range as Range,
				options: {
					description: 'livingCodeRecentChange',
					className: 'living-code-recent-change',
					isWholeLine: true,
					stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
				}
			});
		}

		if (!this.decorations) {
			this.decorations = this.editor.createDecorationsCollection(decorations);
		} else {
			this.decorations.set(decorations);
		}
	}
}

export function getLivingCodeController(editor: ICodeEditor): LivingCodeController | undefined {
	return LivingCodeController.get(editor);
}

