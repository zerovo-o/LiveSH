import { AlertCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import MapPanel from "./components/MapPanel";
import PersonalizedAgentPanel from "./components/PersonalizedAgentPanel";
import StreetPanel from "./components/StreetPanel";
import { Button } from "./components/ui/button";
import type { Summary } from "./types/metrics";
import "./index.css";

function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/summary");
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as Summary;
      setSummary(data);
      setSelectedDistrict((prev) =>
        prev && data.districts.some((item) => item.district === prev) ? prev : null
      );
    } catch {
      setError("后端 API 不可用，请先完成数据入库并启动 FastAPI。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mapRecommendations = useMemo(() => {
    if (!summary) return [];
    return [...summary.districts].sort((a, b) => b.livability_score - a.livability_score).slice(0, 5);
  }, [summary]);

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-50 text-slate-600">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        正在加载项目数据...
      </main>
    );
  }

  if (error || !summary) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <AlertCircle className="h-5 w-5 text-red-500" />
            数据加载失败
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
          <pre className="mt-4 rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
            cd backend{"\n"}python -m app.process_data{"\n"}uvicorn app.main:app --reload
          </pre>
          <Button className="mt-4" onClick={load}>
            重试
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6">
        <section className="grid min-h-[600px] grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
          <StreetPanel
            districts={summary.districts}
            selectedDistrict={selectedDistrict}
            onSelectDistrict={setSelectedDistrict}
          />
          <div className="min-h-[480px]">
            <MapPanel
              districts={summary.districts}
              selectedDistrict={selectedDistrict}
              recommendations={mapRecommendations}
              onSelectDistrict={setSelectedDistrict}
            />
          </div>
          <PersonalizedAgentPanel />
        </section>
      </div>
    </main>
  );
}

export default App;
