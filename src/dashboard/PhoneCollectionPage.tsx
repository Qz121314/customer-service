import { useCallback, useEffect, useState } from 'react';
import {
  downloadPhoneCollection,
  getPhoneCollection,
  type PhoneCollectionDownloadLog,
} from './api';
import { UiIcon } from './icons';
import { Button } from './ui';

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function PhoneCollectionPage() {
  const [count, setCount] = useState(0);
  const [logs, setLogs] = useState<PhoneCollectionDownloadLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getPhoneCollection();
      setCount(result.count);
      setLogs(result.logs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '号码采集加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setError('');
    try {
      const blob = await downloadPhoneCollection();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'visitor-phone-numbers.csv';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '号码文件下载失败。');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section
      className="phone-collection-page"
      aria-labelledby="phone-collection-title"
    >
      <div className="phone-collection-header">
        <div>
          <span className="admin-section-kicker">访客消息</span>
          <h2 id="phone-collection-title">号码采集</h2>
          <p>只采集访客发送消息中的手机号，数据直接来自聊天消息。</p>
        </div>
        <div className="phone-collection-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={loading || downloading}
            onClick={() => void load()}
          >
            <UiIcon name="refresh" />
            {loading ? '读取中…' : '刷新'}
          </Button>
          <Button
            type="button"
            disabled={loading || downloading}
            onClick={() => void handleDownload()}
          >
            <UiIcon name="install" />
            {downloading ? '下载中…' : '下载 Excel'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="phone-collection-count" aria-live="polite">
        <span>已采集手机号</span>
        <strong>{loading ? '…' : count.toLocaleString('zh-CN')}</strong>
        <small>Excel 文件仅包含：时间、号码</small>
      </div>

      <div className="phone-collection-logs admin-table-card">
        <div className="admin-table-title">
          <div>
            <span className="admin-section-kicker">操作记录</span>
            <h3>下载日志</h3>
          </div>
          <span>最近 20 次</span>
        </div>
        {logs.length === 0 ? (
          <p className="phone-collection-empty">暂无下载记录。</p>
        ) : (
          <div className="phone-collection-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">下载时间</th>
                  <th scope="col">文件行数</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={`${log.downloadedAt}-${log.rowCount}`}>
                    <td>{formatTime(log.downloadedAt)}</td>
                    <td>{log.rowCount.toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
