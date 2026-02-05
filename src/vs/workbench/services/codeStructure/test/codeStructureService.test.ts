/*---------------------------------------------------------------------------------------------
 *  Minimal tests for CodeStructureService snapshotting.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { withTestCodeEditor } from '../../../../editor/test/browser/testCodeEditor.js';
import { CodeStructureService } from '../browser/codeStructureService.js';

suite('CodeStructureService', () => {
	test('creates basic snapshot for simple TS file', () => {
		withTestCodeEditor('class Foo {}\nfunction bar() {}', {}, (editor, viewModel) => {
			const service = new CodeStructureService(viewModel.model, console as any);
			const uri = viewModel.model.uri as URI;

			const snapshot = service.getSnapshot(uri);
			assert.ok(snapshot);
		});
	});
});

