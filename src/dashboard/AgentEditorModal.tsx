import { Suspense, lazy, type ComponentProps } from 'react';

const LazyAgentEditorModal = lazy(() =>
  import('./AgentEditorModalImpl').then(({ AgentEditorModal }) => ({
    default: AgentEditorModal,
  })),
);

export function AgentEditorModal(
  props: ComponentProps<typeof LazyAgentEditorModal>,
) {
  return (
    <Suspense fallback={null}>
      <LazyAgentEditorModal {...props} />
    </Suspense>
  );
}
