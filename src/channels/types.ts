import type { OverallStatus } from '../types';

export interface Fact {
  title: string;
  value: string;
}

export interface Action {
  type: 'Action.OpenUrl';
  title: string;
  url: string;
}

/** Result of an optional AnalysisProvider run, folded into the sent message. */
export interface AnalysisBlock {
  summary: string;
  suggestions: string[];
}

/** Provider-agnostic shape every channel translates into its own wire format. */
export interface AlertPayload {
  service: string;
  reportType: 'daily' | 'critical' | 'warning';
  timestamp: string;
  overallStatus: OverallStatus;
  statusColor: 'green' | 'orange' | 'red';
  title: string;
  summary: string;
  facts: Fact[];
  actions: Action[];
  analysis?: AnalysisBlock;
}

/** One notification destination. Implement this to add a provider that
 *  isn't built in — sendNotification() fans out to every configured channel. */
export interface NotificationChannel {
  readonly name: string;
  send(payload: AlertPayload): Promise<boolean>;
}
