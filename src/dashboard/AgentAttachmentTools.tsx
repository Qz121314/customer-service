import { Suspense, lazy, type ComponentProps } from 'react';

type AgentAttachmentToolsModule = typeof import('./AgentAttachmentToolsImpl');
type AgentComposerAttachmentMenuProps = ComponentProps<
  AgentAttachmentToolsModule['AgentComposerAttachmentMenu']
>;

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
