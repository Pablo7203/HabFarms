"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createFeedAdjustmentAction,
  createFeedMixingBatchAction,
  postFeedPurchaseAction,
  recordFeedPaymentAction,
  saveFeedTypeAction,
  saveSupplierAction,
  setOpeningStockAction,
  updateFeedPurchaseAction,
} from "@/app/actions/feed";
type Option = { id: string; name: string; default_bag_size_kg?: number };
const Field = ({
  name,
  label,
  type = "text",
  step,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
}) => (
  <label className="text-sm font-medium">
    {label}
    <Input name={name} type={type} step={step} required className="mt-2" />
  </label>
);
function Shell({
  action,
  children,
  submit = "Save",
  onSuccess,
}: {
  action: (
    f: FormData,
  ) => Promise<{ ok: boolean; message: string; id?: string }>;
  children: React.ReactNode;
  submit?: string;
  onSuccess?: (form: HTMLFormElement) => void;
}) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        start(async () => {
          const r = await action(new FormData(form));
          setMessage(r.message);
          if (r.ok) onSuccess?.(form);
        });
      }}
    >
      {children}
      {message && (
        <p className="rounded-lg bg-stone-100 p-3 text-sm">{message}</p>
      )}
      <Button disabled={pending}>{pending ? "Saving…" : submit}</Button>
    </form>
  );
}
export function FeedTypeForm({ id }: { id?: string }) {
  return (
    <Shell
      action={(f) =>
        saveFeedTypeAction(id, {
          name: f.get("name"),
          defaultBagSizeKg: f.get("bag"),
          description: f.get("description"),
          active: true,
        })
      }
      onSuccess={id ? undefined : (form) => form.reset()}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label="Feed type" />
        <Field
          name="bag"
          label="Default bag size (kg)"
          type="number"
          step="0.001"
        />
      </div>
      <label className="block text-sm font-medium">
        Description
        <textarea
          name="description"
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
export function SupplierForm({ id, types=[], materials=[] }: { id?: string; types?: Option[]; materials?: Option[] }) {
  const router = useRouter();
  return (
    <Shell
      action={(f) =>
        saveSupplierAction(id, {
          name: f.get("name"),
          phone: f.get("phone"),
          email: f.get("email"),
          location: f.get("location"),
          notes: f.get("notes"),
          suppliedFeedTypeIds: f.getAll("supplies"),
          suppliedMaterialIds: f.getAll("materials"),
          active: true,
        })
      }
      onSuccess={() => setTimeout(() => router.push("/feed/suppliers?created=1"), 500)}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label="Supplier name" />
        <Field name="phone" label="Phone" />
        <Field name="email" label="Email" type="email" />
        <Field name="location" label="Location" />
      </div>
      <fieldset className="text-sm font-medium"><legend>Finished feed types they supply</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{types.map(type=><label key={type.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 font-normal"><input type="checkbox" name="supplies" value={type.id}/>{type.name}</label>)}</div></fieldset><fieldset className="text-sm font-medium"><legend>Raw materials they supply</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{materials.map(material=><label key={material.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 font-normal"><input type="checkbox" name="materials" value={material.id}/>{material.name}</label>)}</div>{!types.length&&!materials.length&&<p className="mt-2 text-sm text-stone-500">Create feed types or materials first, then return to set capabilities.</p>}</fieldset>
      <label className="block text-sm font-medium">
        Notes
        <textarea
          name="notes"
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
export function PurchaseForm({
  types,
  suppliers,
  today,
}: {
  types: Option[];
  suppliers: Option[];
  today: string;
}) {
  const router = useRouter();
  return (
    <Shell
      submit="Post purchase"
      action={async (f) => {
        const r = await postFeedPurchaseAction({
          supplierId: f.get("supplier"),
          feedTypeId: f.get("type"),
          purchaseDate: f.get("date"),
          bags: f.get("bags"),
          bagSizeKg: f.get("bagSize"),
          costPerBag: f.get("cost"),
          amountPaid: f.get("paid"),
          paymentMethod: f.get("method"),
          reference: f.get("reference"),
          notes: f.get("notes"),
        });
        if (r.ok && r.id) router.push(`/feed/purchases/${r.id}`);
        return r;
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Feed type
          <select
            name="type"
            required
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Supplier
          <select
            name="supplier"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="">No supplier</option>
            {suppliers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <Input
            name="date"
            type="date"
            defaultValue={today}
            className="mt-2"
          />
        </label>
        <Field name="bags" label="Number of bags" type="number" step="0.001" />
        <Field
          name="bagSize"
          label="Bag size (kg)"
          type="number"
          step="0.001"
        />
        <Field name="cost" label="Cost per bag" type="number" step="0.01" />
        <Field name="paid" label="Initial payment" type="number" step="0.01" />
        <label className="text-sm font-medium">
          Payment method
          <select
            name="method"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="cash">Cash</option>
            <option value="momo">Mobile money</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        </label>
        <Field name="reference" label="Reference" />
      </div>
      <label className="block text-sm font-medium">
        Notes
        <textarea
          name="notes"
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
export function FeedMixingForm({types,today}:{types:Option[];today:string}){const router=useRouter(),[output,setOutput]=useState(types[0]?.id??""),[message,setMessage]=useState(""),[pending,start]=useTransition();return <form className="space-y-5" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const ingredients=types.filter(x=>x.id!==output).map(x=>({feedTypeId:x.id,quantityKg:String(f.get(`ingredient-${x.id}`)??"")}));start(async()=>{const r=await createFeedMixingBatchAction({outputFeedTypeId:output,batchDate:String(f.get("date")),outputKg:String(f.get("output")),ingredients,notes:String(f.get("notes"))});setMessage(r.message);if(r.ok)setTimeout(()=>router.push("/feed/mixing?created=1"),500)})}}><div className="grid gap-5 sm:grid-cols-2"><label>Finished feed<select required value={output} onChange={e=>setOutput(e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border px-3">{types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Date<Input name="date" type="date" defaultValue={today} className="mt-2"/></label><Field name="output" label="Finished feed produced kg" type="number" step="0.001"/></div><fieldset><legend className="font-semibold">Ingredients used from stock</legend><p className="mt-1 text-sm text-stone-500">Enter only the kg used. Material cost is calculated from existing inventory cost.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{types.filter(x=>x.id!==output).map(x=><label key={x.id}>{x.name}<Input name={`ingredient-${x.id}`} type="number" min="0" step="0.001" defaultValue="0" className="mt-2"/></label>)}</div></fieldset><label className="block">Notes<textarea name="notes" className="mt-2 min-h-24 w-full rounded-lg border p-3"/></label>{message&&<p role="status" className="rounded-lg bg-stone-100 p-3 text-sm">{message}</p>}<Button disabled={pending||!output}>{pending?"Recording…":"Record mixing batch"}</Button></form>}
export function OpeningForm({
  types,
  today,
}: {
  types: Option[];
  today: string;
}) {
  return (
    <Shell
      submit="Set opening stock"
      action={(f) =>
        setOpeningStockAction({
          feedTypeId: f.get("type"),
          effectiveDate: f.get("date"),
          bags: f.get("bags"),
          bagSizeKg: f.get("bagSize"),
          costPerBag: f.get("cost"),
          notes: f.get("notes"),
        })
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label>
          Feed type
          <select
            name="type"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <Input name="date" type="date" defaultValue={today} />
        </label>
        <Field
          name="bags"
          label="Quantity in bags"
          type="number"
          step="0.001"
        />
        <Field
          name="bagSize"
          label="Bag size (kg)"
          type="number"
          step="0.001"
        />
        <Field
          name="cost"
          label="Historical cost per bag"
          type="number"
          step="0.01"
        />
      </div>
      <label>
        Notes
        <textarea
          name="notes"
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
export function AdjustmentForm({
  types,
  today,
}: {
  types: Option[];
  today: string;
}) {
  return (
    <Shell
      submit="Record adjustment"
      action={(f) =>
        createFeedAdjustmentAction({
          feedTypeId: f.get("type"),
          movementDate: f.get("date"),
          movementType: f.get("kind"),
          direction: f.get("direction"),
          quantityKg: f.get("quantity"),
          unitCost: f.get("cost"),
          reason: f.get("reason"),
          notes: f.get("notes"),
        })
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label>
          Feed type
          <select
            name="type"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <Input name="date" type="date" defaultValue={today} />
        </label>
        <label>
          Kind
          <select
            name="kind"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="adjustment">Adjustment</option>
            <option value="wastage">Wastage</option>
          </select>
        </label>
        <label>
          Direction
          <select
            name="direction"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="IN">Increase</option>
            <option value="OUT">Decrease</option>
          </select>
        </label>
        <Field
          name="quantity"
          label="Quantity (kg)"
          type="number"
          step="0.001"
        />
        <Field
          name="cost"
          label="Cost per kg (required for increase)"
          type="number"
          step="0.0001"
        />
        <Field name="reason" label="Reason" />
      </div>
      <label>
        Notes
        <textarea
          name="notes"
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
export function FeedPaymentForm({ id, today }: { id: string; today: string }) {
  const router = useRouter();
  return (
    <Shell
      submit="Record payment"
      onSuccess={() => router.refresh()}
      action={(f) =>
        recordFeedPaymentAction(id, {
          paymentDate: f.get("date"),
          amount: f.get("amount"),
          paymentMethod: f.get("method"),
          reference: f.get("reference"),
          notes: "",
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Date
          <Input name="date" type="date" defaultValue={today} />
        </label>
        <Field name="amount" label="Amount" type="number" step="0.01" />
        <label>
          Method
          <select
            name="method"
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="cash">Cash</option>
            <option value="momo">Mobile money</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        </label>
        <Field name="reference" label="Reference" />
      </div>
    </Shell>
  );
}
export function PurchaseEditForm({
  id,
  suppliers,
  record,
}: {
  id: string;
  suppliers: Option[];
  record: {
    supplier_id: string | null;
    purchase_date: string;
    bags: number;
    bag_size_kg: number;
    cost_per_bag: number;
    notes: string | null;
  };
}) {
  return (
    <Shell
      action={(f) =>
        updateFeedPurchaseAction(id, {
          supplierId: f.get("supplier"),
          purchaseDate: f.get("date"),
          bags: f.get("bags"),
          bagSizeKg: f.get("bagSize"),
          costPerBag: f.get("cost"),
          notes: f.get("notes"),
        })
      }
    >
      <label>
        Supplier
        <select
          name="supplier"
          defaultValue={record.supplier_id ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border px-3"
        >
          <option value="">No supplier</option>
          {suppliers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label>
          Date
          <Input name="date" type="date" defaultValue={record.purchase_date} />
        </label>
        <label>
          Bags
          <Input
            name="bags"
            type="number"
            step="0.001"
            defaultValue={record.bags}
          />
        </label>
        <label>
          Bag size kg
          <Input
            name="bagSize"
            type="number"
            step="0.001"
            defaultValue={record.bag_size_kg}
          />
        </label>
        <label>
          Cost per bag
          <Input
            name="cost"
            type="number"
            step="0.01"
            defaultValue={record.cost_per_bag}
          />
        </label>
      </div>
      <label>
        Notes
        <textarea
          name="notes"
          defaultValue={record.notes ?? ""}
          className="mt-2 min-h-24 w-full rounded-lg border p-3"
        />
      </label>
    </Shell>
  );
}
