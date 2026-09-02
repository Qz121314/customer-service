import type {
  AgentAttachmentPreset,
  AgentContactCardKind,
} from './agent-attachments-client';

type ContactCardPreset = Extract<
  AgentAttachmentPreset,
  { kind: AgentContactCardKind }
>;

export type AgentComposerAttachmentMenuProps = {
  disabled: boolean;
  onSendImage: (file: File) => void;
  onSendPreset: (preset: ContactCardPreset) => void;
};

export type AgentCardSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export * from './AgentAttachmentToolsRuntime';
