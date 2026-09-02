import { Suspense, lazy } from 'react';
import type {
  AgentCardSettingsModalProps,
  AgentComposerAttachmentMenuProps,
} from './AgentAttachmentToolsImpl';

const LazyAgentComposerAttachmentMenu = lazy(() =>
  import('./AgentAttachmentToolsImpl').then(
    ({ AgentComposerAttachmentMenu }) => ({
      default: AgentComposerAttachmentMenu,
    }),
  ),
);

const LazyAgentCardSettingsModal = lazy(() =>
  import('./AgentAttachmentToolsImpl').then(({ AgentCardSettingsModal }) => ({
    default: AgentCardSettingsModal,
  })),
);

export function AgentComposerAttachmentMenu(
  props: AgentComposerAttachmentMenuProps,
) {
  return (
    <Suspense fallback={null}>
      <LazyAgentComposerAttachmentMenu {...props} />
    </Suspense>
  );
}

export function AgentCardSettingsModal(props: AgentCardSettingsModalProps) {
  return (
    <Suspense fallback={null}>
      <LazyAgentCardSettingsModal {...props} />
    </Suspense>
  );
}
