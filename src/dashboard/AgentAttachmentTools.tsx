import { Suspense, lazy, type ComponentProps } from 'react';

const LazyAgentComposerAttachmentMenu = lazy(() =>
  import('./AgentAttachmentToolsImpl').then(
    ({ AgentComposerAttachmentMenu }) => ({
      default: AgentComposerAttachmentMenu,
    }),
  ),
);

export function AgentComposerAttachmentMenu(
  props: ComponentProps<typeof LazyAgentComposerAttachmentMenu>,
) {
  return (
    <Suspense fallback={null}>
      <LazyAgentComposerAttachmentMenu {...props} />
    </Suspense>
  );
}
