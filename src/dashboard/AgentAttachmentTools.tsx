import { Suspense, lazy } from 'react';

type AgentAttachmentToolsModule = typeof import('./AgentAttachmentToolsImpl');
type AgentComposerAttachmentMenuProps = Parameters<
  AgentAttachmentToolsModule['AgentComposerAttachmentMenu']
>[0];

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
