/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Position } from '../../../../editor/common/core/position.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ICodeGraphService } from '../../../services/codeGraph/common/codeGraph.js';
import { ICodeStructureService } from '../../../services/codeStructure/common/codeStructure.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

function getActiveSymbol(editorService: IEditorService, structureService: ICodeStructureService): { uri: URI; position: Position; symbolId: string } | undefined {
	const editor = editorService.activeTextEditorControl;
	if (!editor || !isCodeEditor(editor)) {
		return undefined;
	}

	const model = editor.getModel();
	const position = editor.getPosition();
	if (!model || !position) {
		return undefined;
	}

	const uri = model.uri;
	const symbol = structureService.getSymbolAtPosition(uri, position);
	if (!symbol) {
		return undefined;
	}

	return { uri, position, symbolId: symbol.id };
}

CommandsRegistry.registerCommand('codeGraph.explainSymbol', accessor => {
	const editorService = accessor.get(IEditorService);
	const structureService = accessor.get(ICodeStructureService);
	const graphService = accessor.get(ICodeGraphService);
	const notificationService = accessor.get(INotificationService);

	const active = getActiveSymbol(editorService, structureService);
	if (!active) {
		notificationService.notify({
			severity: Severity.Info,
			message: 'No symbol found at cursor to explain.'
		});
		return;
	}

	const snapshot = graphService.getSnapshot(active.uri);
	const symbol = snapshot?.symbols.find(s => s.id === active.symbolId);

	const callers = graphService.getCallers(active.symbolId);
	const callees = graphService.getCallees(active.symbolId);

	const callerCount = callers.length;
	const calleeCount = callees.length;

	const messageParts: string[] = [];
	if (symbol) {
		messageParts.push(`Symbol: ${symbol.name}`);
		messageParts.push(`Location: ${symbol.uri.fsPath}`);
	}
	messageParts.push(`Direct callers: ${callerCount}`);
	messageParts.push(`Direct callees: ${calleeCount}`);

	notificationService.notify({
		severity: Severity.Info,
		message: messageParts.join('\n')
	});
});

CommandsRegistry.registerCommand('codeGraph.deletionImpact', accessor => {
	const editorService = accessor.get(IEditorService);
	const structureService = accessor.get(ICodeStructureService);
	const graphService = accessor.get(ICodeGraphService);
	const notificationService = accessor.get(INotificationService);

	const active = getActiveSymbol(editorService, structureService);
	if (!active) {
		notificationService.notify({
			severity: Severity.Info,
			message: 'No symbol found at cursor to analyse deletion impact.'
		});
		return;
	}

	const visited = new Set<string>();
	const queue: string[] = [active.symbolId];
	const impacted = new Set<string>();

	while (queue.length) {
		const current = queue.shift()!;
		if (visited.has(current)) {
			continue;
		}
		visited.add(current);

		for (const edge of graphService.getCallers(current)) {
			if (!impacted.has(edge.from)) {
				impacted.add(edge.from);
				queue.push(edge.from);
			}
		}
	}

	const impactedCount = impacted.size;

	notificationService.notify({
		severity: Severity.Info,
		message: impactedCount === 0
			? 'No direct impact detected from deleting this symbol in the current graph.'
			: `Potentially impacted symbols if deleted: ${impactedCount}`
	});
});

CommandsRegistry.registerCommand('codeGraph.findConceptualDuplicates', accessor => {
	const editorService = accessor.get(IEditorService);
	const structureService = accessor.get(ICodeStructureService);
	const graphService = accessor.get(ICodeGraphService);
	const notificationService = accessor.get(INotificationService);
	const instaService = accessor.get(IInstantiationService);

	const active = getActiveSymbol(editorService, structureService);
	if (!active) {
		notificationService.notify({
			severity: Severity.Info,
			message: 'No symbol found at cursor to search for duplicates.'
		});
		return;
	}

	const snapshot = graphService.getSnapshot(active.uri);
	const symbol = snapshot?.symbols.find(s => s.id === active.symbolId);
	if (!symbol || !snapshot) {
		notificationService.notify({
			severity: Severity.Info,
			message: 'No structural information available for current symbol.'
		});
		return;
	}

	const duplicates = snapshot.symbols.filter(s => s.name === symbol.name && s.id !== symbol.id);

	if (!duplicates.length) {
		notificationService.notify({
			severity: Severity.Info,
			message: `No obvious duplicates of "${symbol.name}" found in this file.`
		});
		return;
	}

	const formatted = duplicates.map(d => `${d.name} at ${d.uri.fsPath}`).join('\n');
	notificationService.notify({
		severity: Severity.Info,
		message: `Possible duplicates of "${symbol.name}":\n${formatted}`
	});
});

