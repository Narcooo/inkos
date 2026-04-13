interface FloatingPanelsProps {
  children: React.ReactNode;
}

export function FloatingPanels({ children }: FloatingPanelsProps) {
  return (
    <div className="fixed right-4 top-16 z-30 flex w-[280px] flex-col gap-2">
      {children}
    </div>
  );
}
