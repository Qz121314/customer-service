import { useEffect, useMemo, useState } from 'react';
import {
  type AgentAccount,
  type TrafficOverviewStats,
  getTrafficOverviewStats,
} from './api';
import type { AdminSection } from './AdminShell';
import { message } from './dashboard-runtime';
import {
  trafficRangePeriod,
  type TrafficRange,
} from './traffic-statistics-range';

export function useAdminStatisticsController(section: AdminSection) {
  const [trafficRange, setTrafficRange] = useState<TrafficRange>('today');
  const [trafficStats, setTrafficStats] = useState<TrafficOverviewStats | null>(
    null,
  );
  const [statisticsAgent, setStatisticsAgent] = useState<AgentAccount | null>(
    null,
  );
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState('');
  const trafficPeriod = useMemo(
    () => trafficRangePeriod(trafficRange),
    [trafficRange],
  );

  useEffect(() => {
    if (section !== 'statistics') return;
    let active = true;
    setStatsError('');
    setStatsBusy(true);
    getTrafficOverviewStats(trafficPeriod.from, trafficPeriod.to)
      .then((result) => {
        if (active) setTrafficStats(result);
      })
      .catch((reason) => {
        if (active) setStatsError(message(reason, '无法加载流量统计'));
      })
      .finally(() => {
        if (active) setStatsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [section, trafficPeriod.from, trafficPeriod.to]);

  function handleAgentDeleted(agentId: string) {
    if (statisticsAgent?.id === agentId) setStatisticsAgent(null);
  }

  return {
    pageProps: {
      range: trafficRange,
      stats: trafficStats,
      busy: statsBusy,
      error: statsError,
      onClearError: () => setStatsError(''),
      onRangeChange: (range: TrafficRange) => {
        setStatsBusy(true);
        setTrafficRange(range);
      },
    },
    statisticsAgent,
    openAgentStatistics: setStatisticsAgent,
    closeAgentStatistics: () => setStatisticsAgent(null),
    handleAgentDeleted,
  };
}
