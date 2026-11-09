import type { CameraController } from '@core/camera-controller'
import { useCameraValue } from '@renderer/canvas/useCameraValue'

interface Props {
  camera: CameraController
  onFitAll(): void
  onFitSelection(): void
  canFitSelection: boolean
  dark: boolean
  onToggleTheme(): void
}

/** Иконка «вписать всё»: рамка с уголками, раздвигающимися наружу. */
function FitAllIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path
        d="M2 5.5V2.5h3M14 5.5V2.5h-3M2 10.5v3h3M14 10.5v3h-3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Иконка «вписать выделенное»: та же рамка, внутри залитый прямоугольник. */
function FitSelectionIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path
        d="M2 5V2.5h2.5M14 5V2.5h-2.5M2 11v2.5h2.5M14 11v2.5h-2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ThemeIcon({ dark }: { dark: boolean }): React.JSX.Element {
  return dark ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path
        d="M13.7 10.1A6.2 6.2 0 0 1 5.9 2.3 6.2 6.2 0 1 0 13.7 10.1Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Hud({
  camera,
  onFitAll,
  onFitSelection,
  canFitSelection,
  dark,
  onToggleTheme
}: Props): React.JSX.Element {
  const cam = useCameraValue(camera)
  const themeLabel = dark ? 'Включить светлую тему' : 'Включить тёмную тему'
  return (
    <div className="panel hud">
      <button type="button" className="panel__btn hud__icon" title="Вписать всё (Shift+1)" onClick={onFitAll}>
        <FitAllIcon />
      </button>
      <button
        type="button"
        className="panel__btn hud__icon"
        title="Вписать выделенное (Shift+2)"
        disabled={!canFitSelection}
        onClick={onFitSelection}
      >
        <FitSelectionIcon />
      </button>
      <span className="panel__sep" />
      <button
        type="button"
        className="panel__btn"
        title="Уменьшить"
        onClick={() => camera.zoomToCenter(cam.zoom / 1.25)}
      >
        −
      </button>
      <button
        type="button"
        className="panel__btn hud__zoom"
        title="Масштаб 100%"
        onClick={() => camera.zoomToCenter(1)}
      >
        {Math.round(cam.zoom * 100)}%
      </button>
      <button
        type="button"
        className="panel__btn"
        title="Увеличить"
        onClick={() => camera.zoomToCenter(cam.zoom * 1.25)}
      >
        +
      </button>
      <span className="panel__sep" />
      <button
        type="button"
        className="panel__btn hud__icon"
        title={themeLabel}
        aria-label={themeLabel}
        aria-pressed={dark}
        data-testid="theme-toggle"
        onClick={onToggleTheme}
      >
        <ThemeIcon dark={dark} />
      </button>
    </div>
  )
}
