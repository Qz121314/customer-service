import { Suspense, lazy } from 'react';
import type { AgentComposerAttachmentMenuProps } from './AgentAttachmentToolsImpl';

const LazyAgentComposerAttachmentMenu = lazy(() =>
  import('./AgentAttachmentToolsImpl').then(
    ({ AgentComposerAttachmentMenu }) => ({
      default: AgentComposerAttachmentMenu,
    }),
  ),
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
