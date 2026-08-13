import React from 'react';
import type { DataGridCellComponentProps } from '../types';
import { BaseCell } from './base-cell';

export function RichCell<TRow>(props: DataGridCellComponentProps<TRow>) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      className="absolute h-full"
      style={props.style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BaseCell
        {...props}
        context={{
          ...props.context,
          state: { ...props.context.state, hovered },
        }}
        style={{ ...props.style, left: 0, top: 0 }}
      />
    </div>
  );
}
