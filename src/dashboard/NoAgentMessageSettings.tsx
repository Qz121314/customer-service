import { Suspense, lazy } from 'react';
import type { NoAgentMessageSettingsProps } from './NoAgentMessageSettingsImpl';

const LazyNoAgentMessageSettingsPanel = lazy(() =>
  import('./NoAgentMessageSettingsImpl').then(
    ({ NoAgentMessageSettingsPanel }) => ({
      default: NoAgentMessageSettingsPanel,
    }),
  ),
);

export function NoAgentMessageSettingsPanel(
  props: NoAgentMessageSettingsProps,
) {
  return (
    <Suspense fallback={<div className="empty-state">正在加载访客体验…</div>}>
      <LazyNoAgentMessageSettingsPanel {...props} />
    </Suspense>
  );
}
