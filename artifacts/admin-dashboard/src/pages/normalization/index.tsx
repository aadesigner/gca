import React, { useState } from "react";
import {
  useListLowConfidenceVehicles,
  useCreateNormalizationOverride,
  useListNormalizationOverrides,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Edit3,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const OVERRIDEABLE_FIELDS = ["make", "model", "year", "trim", "bodyType", "fuelType", "transmission", "driveType"] as const;

export default function Normalization() {
  const [fieldFilter, setFieldFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useListLowConfidenceVehicles({
    field: fieldFilter || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Normalization Quality</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Vehicles with missing or low-confidence fields. Apply manual overrides to correct data.
        </p>
      </div>

      {/* Field filter */}
      <div className="flex items-center gap-2 flex-wrap bg-card p-4 rounded-xl border border-border shadow-sm">
        <span className="text-xs text-muted-foreground font-mono">Field:</span>
        <button
          onClick={() => setFieldFilter("")}
          className={`px-2.5 py-1 rounded text-xs font-mono font-semibold uppercase tracking-wider transition-colors ${
            !fieldFilter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          ALL
        </button>
        {OVERRIDEABLE_FIELDS.map(f => (
          <button
            key={f}
            onClick={() => setFieldFilter(fieldFilter === f ? "" : f)}
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold uppercase tracking-wider transition-colors ${
              fieldFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Summary */}
      {data && (
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{data.total.toLocaleString()}</span>{" "}
          vehicle{data.total !== 1 ? "s" : ""} with missing or incomplete normalization data
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">VIN</th>
                <th className="px-6 py-4">Vehicle</th>
                <th className="px-6 py-4">Missing Fields</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    ANALYZING_QUALITY...
                  </td>
                </tr>
              ) : !data?.items.length ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <CheckSquare className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No low-confidence records found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                data.items.map(vehicle => (
                  <React.Fragment key={vehicle.id}>
                    <tr
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === vehicle.id ? null : vehicle.id)}
                    >
                      <td className="px-6 py-4 font-mono font-semibold text-primary">{vehicle.vin}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium">
                          {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown Vehicle"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(vehicle.missingFields ?? []).map((f: string) => (
                            <span key={f} className="bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded text-xs font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="sm" className="h-8">
                            <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                            Override
                          </Button>
                          {expandedId === vehicle.id ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === vehicle.id && (
                      <tr>
                        <td colSpan={4} className="bg-muted/20 px-6 py-4 border-b border-border">
                          <VehicleOverridePanel vehicleId={vehicle.id} vehicle={vehicle} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VehicleOverridePanel({ vehicleId, vehicle }: { vehicleId: number; vehicle: any }) {
  const { data: existingOverrides } = useListNormalizationOverrides(vehicleId);
  const createOverride = useCreateNormalizationOverride();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");

  const startEdit = (field: string) => {
    setEditingField(field);
    setEditValue(String(vehicle[field] ?? ""));
    setEditReason("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
    setEditReason("");
  };

  const submitOverride = (field: string) => {
    createOverride.mutate(
      {
        vehicleId,
        data: {
          field: field as any,
          overriddenValue: editValue,
          reason: editReason || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: `${field} updated`, description: `Set to "${editValue}"` });
          cancelEdit();
          queryClient.invalidateQueries();
        },
        onError: (err: any) => {
          toast({ title: "Override failed", description: err?.message, variant: "destructive" });
        },
      },
    );
  };

  // Build current field values
  const fields: Record<string, unknown> = {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    trim: vehicle.trim,
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    driveType: vehicle.driveType,
  };

  const overridesMap = Object.fromEntries((existingOverrides ?? []).map(o => [o.field, o]));

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Field Overrides for {vehicle.vin}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(fields).map(([field, value]) => {
          const override = overridesMap[field];
          const isMissing = value == null || value === "";
          const isEditing = editingField === field;

          return (
            <div
              key={field}
              className={`rounded-lg border p-3 ${isMissing ? "border-amber-200 bg-amber-50/50" : override ? "border-green-200 bg-green-50/50" : "border-border bg-background"}`}
            >
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center justify-between">
                <span>{field}</span>
                {override && <Check className="w-3 h-3 text-green-600" />}
                {isMissing && !override && <AlertTriangle className="w-3 h-3 text-amber-500" />}
              </div>

              {isEditing ? (
                <div className="space-y-1.5">
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder={`New ${field}...`}
                    className="h-7 text-xs"
                    autoFocus
                  />
                  <Input
                    value={editReason}
                    onChange={e => setEditReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1 mt-1">
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => submitOverride(field)}
                      disabled={!editValue || createOverride.isPending}
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end justify-between gap-1">
                  <div className="text-sm font-mono">
                    {value != null && value !== "" ? String(value) : (
                      <span className="text-amber-500 text-xs italic">missing</span>
                    )}
                    {override && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        by {override.overriddenByEmail ?? "admin"}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => startEdit(field)}
                    className="text-muted-foreground hover:text-primary transition-colors p-0.5"
                    title={`Edit ${field}`}
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
