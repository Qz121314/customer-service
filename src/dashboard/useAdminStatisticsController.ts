import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentAccount,
  type AdminTrafficRealtimeEvent,
  type TrafficOverviewStats,
  getTrafficOverviewStats,
  openAdminStatisticsSocket,
  realtimeReconnectDelay,
} from './api';
import type { AdminSection } from './AdminShell';
import { message } from './dashboard-runtime';
import {
  trafficRangePeriod,
  type TrafficRange,
} from './traffic-statistics-range';
import {
  readTrafficStatsCache,
  writeTrafficStatsCache,
} from './traffic-statistics-cache';

export function useAdminStatisticsController(section: AdminSection) {
  const [trafficRange, setTrafficRange] = useState<TrafficRange>('3d');
  const [trafficStats, setTrafficStats] = useState<TrafficOverviewStats | null>(
    null,
  );
  const [statisticsAgent, setStatisticsAgent] = useState<AgentAccount | null>(
    null,
  );
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState('');
  const statsRef = useRef<TrafficOverviewStats | null>(null);
  const requestIdRef = useRef(0);
  const appliedEventIdsRef = useRef(new Set<string>());
  const trafficPeriod = useMemo(
    () => trafficRangePeriod(trafficRange),
    [trafficRange],
  );

  const loadStats = useCallback(
    async (activeRef?: { current: boolean }) => {
      const requestId = ++requestIdRef.current;
      setStatsError('');
      setStatsBusy(true);
      try {
        const result = await getTrafficOverviewStats(
          trafficPeriod.from,
          trafficPeriod.to,
        );
        if (
          (!activeRef || activeRef.current) &&
          requestId === requestIdRef.current
        ) {
          statsRef.current = result;
          setTrafficStats(result);
          writeTrafficStatsCache(result);
        }
      } catch (reason) {
        if (
          (!activeRef || activeRef.current) &&
          requestId === requestIdRef.current
        ) {
          setStatsError(message(reason, '无法加载流量统计'));
        }
        throw reason;
      } finally {
        if (
          (!activeRef || activeRef.current) &&
          requestId === requestIdRef.current
        ) {
          setStatsBusy(false);
        }
      }
    },
    [trafficPeriod.from, trafficPeriod.to],
  );

  useEffect(() => {
    if (section !== 'dashboard') return;
    const active = { current: true };
    appliedEventIdsRef.current.clear();
    const cached = readTrafficStatsCache(trafficPeriod.from, trafficPeriod.to);
    if (cached) {
      statsRef.current = cached;
      setTrafficStats(cached);
      setStatsBusy(false);
    }
    void loadStats(active).catch(() => undefined);
    return () => {
      active.current = false;
    };
  }, [loadStats, section, trafficPeriod.from, trafficPeriod.to]);

  useEffect(() => {
    if (section !== 'dashboard' || trafficRange !== 'today') return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let resyncOnReconnect = false;

    const applyEvent = (event: AdminTrafficRealtimeEvent) => {
      if (!active || event.type !== 'traffic.receipt.created') return;
      if (appliedEventIdsRef.current.has(event.eventId)) return;
      appliedEventIdsRef.current.add(event.eventId);
      const current = statsRef.current;
      if (!current || current.to !== event.businessDate) return;
      const nextAgents = addAgentCount(
        current.agents,
        event.agent.id,
        event.agent.name,
      );
      const nextProducts = addProductCount(
        current.products,
        event.product.id,
        event.product.title,
      );
      const next = {
        ...current,
        total: current.total + 1,
        agents: nextAgents,
        products: nextProducts,
      };
      statsRef.current = next;
      setTrafficStats(next);
    };

    const connect = () => {
      if (!active) return;
      socket = openAdminStatisticsSocket();
      socket.addEventListener('open', () => {
        if (resyncOnReconnect) {
          resyncOnReconnect = false;
          void loadStats({ current: active }).catch(() => undefined);
        }
        reconnectAttempt = 0;
      });
      socket.addEventListener('message', (event) => {
        try {
          applyEvent(
            JSON.parse(String(event.data)) as AdminTrafficRealtimeEvent,
          );
        } catch {
          // Ignore malformed or heartbeat frames.
        }
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        resyncOnReconnect = true;
        const delay = realtimeReconnectDelay(reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [loadStats, section, trafficRange]);

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
        setTrafficRange(range);
      },
    },
    statisticsAgent,
    openAgentStatistics: setStatisticsAgent,
    closeAgentStatistics: () => setStatisticsAgent(null),
    handleAgentDeleted,
  };
}

function addAgentCount(
  rows: TrafficOverviewStats['agents'],
  id: string | null,
  name: string,
): TrafficOverviewStats['agents'] {
  const index = rows.findIndex((row) => row.agentId === id);
  if (index >= 0) {
    return rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, count: row.count + 1 } : row,
    );
  }
  return [...rows, { agentId: id, agentName: name, count: 1 }];
}

function addProductCount(
  rows: TrafficOverviewStats['products'],
  id: string | null,
  title: string,
): TrafficOverviewStats['products'] {
  const index = rows.findIndex((row) => row.productId === id);
  if (index >= 0) {
    return rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, count: row.count + 1 } : row,
    );
  }
  return [...rows, { productId: id, productTitle: title, count: 1 }];
}
