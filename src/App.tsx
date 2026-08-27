import { BarChart3, Database, Moon, Sun } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './index.css'
import { ChartsPage } from './pages/ChartsPage'
import { DataPage } from './pages/DataPage'
import type { WorkspaceState } from './types/market'
import { createInitialWorkspace, loadWorkspace, saveWorkspace } from './services/workspaceStorage'

type ActiveTab = 'data' | 'charts'

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createInitialWorkspace())
  const [activeTab, setActiveTab] = useState<ActiveTab>('data')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void loadWorkspace().then((saved) => {
      setWorkspace(saved)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme
    if (loaded) void saveWorkspace(workspace)
  }, [loaded, workspace])

  const stats = useMemo(() => {
    const rows = workspace.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0)
    return {
      datasets: workspace.datasets.length,
      rows,
    }
  }, [workspace.datasets])

  function updateWorkspace(patch: Partial<WorkspaceState>) {
    setWorkspace((current) => {
      const next = { ...current, ...patch }
      const datasetIds = new Set(next.datasets.map((dataset) => dataset.id))
      const groupIds = new Set(next.groups.map((group) => group.id))

      return {
        ...next,
        activeDatasetId: datasetIds.has(next.activeDatasetId)
          ? next.activeDatasetId
          : next.datasets[0]?.id ?? '',
        collapsedGroupIds: next.collapsedGroupIds.filter((id) => groupIds.has(id)),
        chartFilter: {
          ...next.chartFilter,
          panels: next.chartFilter.panels.map((panel, index) => ({
            ...panel,
            datasetId: datasetIds.has(panel.datasetId)
              ? panel.datasetId
              : next.datasets[index % Math.max(next.datasets.length, 1)]?.id ?? '',
          })),
        },
      }
    })
  }

  function setTheme(theme: WorkspaceState['theme']) {
    setWorkspace((current) => ({ ...current, theme }))
  }

  function viewDatasetChart(datasetId: string) {
    setWorkspace((current) => ({
      ...current,
      activeDatasetId: datasetId,
      chartFilter: {
        ...current.chartFilter,
        panels: current.chartFilter.panels.map((panel, index) =>
          index === 0 ? { ...panel, datasetId } : panel,
        ),
      },
    }))
    setActiveTab('charts')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1>Market Data Visualizer</h1>
            <p>{stats.datasets} datasets | {stats.rows.toLocaleString()} rows</p>
          </div>
        </div>

        <nav className="top-tabs" aria-label="Primary">
          <button
            type="button"
            className={activeTab === 'data' ? 'active' : ''}
            onClick={() => setActiveTab('data')}
          >
            <Database size={17} />
            Data Input
          </button>
          <button
            type="button"
            className={activeTab === 'charts' ? 'active' : ''}
            onClick={() => setActiveTab('charts')}
          >
            <BarChart3 size={17} />
            Charts
          </button>
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            title="Toggle theme"
            onClick={() => setTheme(workspace.theme === 'dark' ? 'light' : 'dark')}
          >
            {workspace.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      {activeTab === 'data' ? (
        <DataPage
          datasets={workspace.datasets}
          groups={workspace.groups}
          collapsedGroupIds={workspace.collapsedGroupIds}
          activeDatasetId={workspace.activeDatasetId}
          onWorkspaceChange={updateWorkspace}
          onViewChart={viewDatasetChart}
        />
      ) : (
        <ChartsPage
          datasets={workspace.datasets}
          theme={workspace.theme}
          chartFilter={workspace.chartFilter}
          onChartFilterChange={(chartFilter) => updateWorkspace({ chartFilter })}
        />
      )}
    </div>
  )
}

export default App
