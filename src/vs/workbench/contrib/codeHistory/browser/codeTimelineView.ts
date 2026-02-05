/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeHistoryService, CodeHistoryEvent } from '../../../services/codeHistory/common/codeHistory.js';

/**
 * Placeholder for a richer timeline scrubber UI.
 *
 * The initial implementation exposes history via the generic timeline
 * view while this class encapsulates helper routines for semantic
 * inspection of events for the active editor.
 */
export class CodeTimelineView extends Disposable {

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ICodeHistoryService private readonly codeHistoryService: ICodeHistoryService
	) {
		super();
	}

	getEventsForActiveEditor(): readonly CodeHistoryEvent[] {
		const active = this.editorService.activeTextEditorControl;
		if (!active || !('getModel' in active)) {
			return [];
		}

		const editor = active as ICodeEditor;
		const model = editor.getModel();
		if (!model) {
			return [];
		}

		return this.codeHistoryService.getEventsForFile(model.uri as URI);
	}

	getTitle(): string {
		return localize('codeTimelineTitle', "Code Timeline");
	}
}

