import { Suspense, lazy } from 'react';

type AgentEditorModalModule = typeof import('./AgentEditorModalImpl');
type AgentEditorModalProps = Parameters<
  AgentEditorModalModule['AgentEditorModal']
>[0];

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
