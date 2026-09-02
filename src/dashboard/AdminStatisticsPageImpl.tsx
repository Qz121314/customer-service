import type {
  AgentAccount,
  ProductCatalogItem,
  TrafficOverviewStats,
} from './api';
import type { TrafficRange } from './traffic-statistics-range';

export type AdminStatisticsPageProps = {
  agents: Array<Pick<AgentAccount, 'id' | 'adminLabel'>>;
  products: ProductCatalogItem[];
  range: TrafficRange;
  stats: TrafficOverviewStats | null;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onRangeChange: (range: TrafficRange) => void;
};

export * from './AdminStatisticsPageRuntime';
