import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import {
  type ChatPageModelGroup,
  filterModelGroups,
} from "../chat-page-state";

interface ModelPickerContentProps {
  readonly groupedModels: ReadonlyArray<ChatPageModelGroup>;
  readonly selectedModel: string | null;
  readonly selectedService: string | null;
  readonly onSelect: (model: string, service: string) => void;
  readonly onManage: () => void;
}

export function ModelPickerContent({
  groupedModels,
  selectedModel,
  selectedService,
  onSelect,
  onManage,
}: ModelPickerContentProps) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => filterModelGroups(groupedModels, search),
    [groupedModels, search]
  );

  return (
    <DropdownMenuContent side="top" align="start" className="w-64 max-h-80 flex flex-col">
      <div className="px-2 py-1.5 border-b border-border/30">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索模型..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.map((group) => (
          <div key={group.service}>
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </div>
            {group.models.map((model) => {
              const isSelected = selectedModel === model.id && selectedService === group.service;
              return (
                <DropdownMenuItem
                  key={`${group.service}:${model.id}`}
                  onClick={() => onSelect(model.id, group.service)}
                  className={isSelected ? "bg-muted/50" : ""}
                >
                  <div className="flex flex-1 items-center justify-between">
                    <span className="text-sm">{model.name ?? model.id}</span>
                    {isSelected && <Check size={14} className="text-primary shrink-0" />}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center italic">
            无匹配模型
          </div>
        )}
      </div>
      <div className="border-t border-border/30">
        <DropdownMenuItem onClick={onManage} className="text-primary">
          管理服务商
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  );
}
