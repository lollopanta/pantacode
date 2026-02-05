/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ITimelineService, Timeline, TimelineItem, TimelineOptions } from '../../timeline/common/timeline.js';
import { ICodeHistoryService } from '../../../services/codeHistory/common/codeHistory.js';

export class CodeHistoryTimeline extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.codeHistoryTimeline';

	readonly id = 'timeline.codeHistory';
	readonly label = localize('codeHistory', "Code History");
	readonly scheme = '*';

	constructor(
		@ITimelineService private readonly timelineService: ITimelineService,
		@ICodeHistoryService private readonly codeHistoryService: ICodeHistoryService
	) {
		super();

		this.timelineService.registerTimelineProvider(this);
	}

	async provideTimeline(uri: URI, _options: TimelineOptions, _token: CancellationToken): Promise<Timeline> {
		const events = this.codeHistoryService.getEventsForFile(uri);

		const items: TimelineItem[] = events.map(e => ({
			handle: e.id,
			label: e.summary,
			source: this.id,
			timestamp: e.timestamp
		}));

		return {
			source: this.id,
			items
		};
	}
}

