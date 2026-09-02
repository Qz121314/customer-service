import { Suspense, lazy, type ComponentProps } from 'react';

const LazyNoAgentMessageSettingsPanel = lazy(() =>
  import('./NoAgentMessageSettingsImpl').then(
    ({ NoAgentMessageSettingsPanel }) => ({
      default: NoAgentMessageSettingsPanel,
    }),
  ),
);

export function NoAgentMessageSettingsPanel(
  props: ComponentProps<typeof LazyNoAgentMessageSettingsPanel>,
) {
  return (
    <Suspense fallback={<div className="empty-state">正在加载访客体验…</div>}>
      <LazyNoAgentMessageSettingsPanel {...props} />
    </Suspense>
  );
}
