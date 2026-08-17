import React from 'react';
import { createPortal } from 'react-dom';
import { useDataGridPortalContainer } from '../ui/portal';
import { DataGridThemeScope } from '../ui/theme-scope';

type DataGridOverlayState = {
  anchor: HTMLElement;
  content: React.ReactNode;
} | null;

export type DataGridOverlayController = {
  overlay: DataGridOverlayState;
  openOverlay(anchor: HTMLElement, content: React.ReactNode): void;
  closeOverlay(): void;
};

export function useDataGridOverlay(): DataGridOverlayController {
  const [overlay, setOverlay] = React.useState<DataGridOverlayState>(null);

  return React.useMemo(
    () => ({
      overlay,
      openOverlay(anchor, content) {
        setOverlay({ anchor, content });
      },
      closeOverlay() {
        setOverlay(null);
      },
    }),
    [overlay]
  );
}

export function DataGridOverlay({
  overlay,
  onClose,
}: {
  overlay: DataGridOverlayState;
  onClose: () => void;
}) {
  const portalContainer = useDataGridPortalContainer();
  const [position, setPosition] = React.useState<React.CSSProperties>({});

  React.useLayoutEffect(() => {
    if (overlay === null) {
      return;
    }

    const rect = overlay.anchor.getBoundingClientRect();
    setPosition({
      position: 'fixed',
      left: rect.left,
      top: rect.bottom + 6,
      minWidth: rect.width,
    });
  }, [overlay]);

  React.useEffect(() => {
    if (overlay === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        overlay.anchor.focus();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, overlay]);

  if (overlay === null) {
    return null;
  }

  const root = portalContainer ?? document.body;
  return createPortal(
    // The `--dg-*` tokens live on `.cotera-griddle`, and this content is
    // portalled outside it. Without the scope every colour below resolves to
    // nothing — invisible against a host that happens to define the same token
    // names, obvious only in production against one that does not.
    <DataGridThemeScope>
      <div
        className="z-50 rounded-lg border border-(color:--dg-border) bg-(--dg-popover) p-2 text-(color:--dg-popover-fg) shadow-lg"
        style={position}
        role="dialog"
      >
        {overlay.content}
      </div>
    </DataGridThemeScope>,
    root
  );
}
