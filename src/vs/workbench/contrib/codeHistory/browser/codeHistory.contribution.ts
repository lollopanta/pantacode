/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { CodeHistoryTimeline } from './codeHistoryTimeline.js';

// Register Code History Timeline
registerWorkbenchContribution2(CodeHistoryTimeline.ID, CodeHistoryTimeline, WorkbenchPhase.BlockRestore /* registrations only */);

