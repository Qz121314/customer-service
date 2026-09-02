import { Suspense, lazy } from 'react';
import type { AgentEditorModalProps } from './AgentEditorModalImpl';

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
