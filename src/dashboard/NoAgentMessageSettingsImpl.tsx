import type { NoAgentMessageSettings } from './api';

export type NoAgentMessageSettingsProps = {
  settings: NoAgentMessageSettings;
  saving: boolean;
  onSave: (settings: NoAgentMessageSettings) => Promise<void>;
};

export * from './NoAgentMessageSettingsRuntime';
