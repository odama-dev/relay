"use client";

import { useState } from "react";
import { simulatePayment } from "./actions";

export function SimulatePay(props: { requestId: string; amount: number; currency: string; xenditId: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(props.amount));
  return (
    <div className="mt-6 flex flex-col gap-3">
      <label className="text-body">
        Amount paid
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 tabular-nums" />
      </label>
      <button
        className="rounded-md bg-zinc-900 px-4 py-2 text-body font-medium text-white"
        onClick={async () => setResult(await simulatePayment({ ...props, amount: Number(amount) }))}
      >
        Pay now (send webhook)
      </button>
      <button
        className="rounded-md border px-4 py-2 text-body"
        onClick={async () => setResult(await simulatePayment({ ...props, amount: Number(amount), duplicate: true }))}
      >
        Send the same webhook twice
      </button>
      {result && <pre className="rounded-md bg-zinc-100 p-2 text-caption whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}
