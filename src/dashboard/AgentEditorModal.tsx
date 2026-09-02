import { Suspense, lazy, type ComponentProps } from 'react';

type AgentEditorModalModule = typeof import('./AgentEditorModalImpl');
type AgentEditorModalProps = ComponentProps<
  AgentEditorModalModule['AgentEditorModal']
>;

const LazyAgentEditorModal = lazy(() =>
  import('./AgentEditorModalImpl').then(({ AgentEditorModal }) => ({
    default: AgentEditorModal,
  })),
);

export function AgentEditorModal(props: AgentEditorModalProps) {
  return (
    <Suspense fallback={null}>
      <LazyAgentEditorModal {...props} />
    </Suspense>
  );
}
