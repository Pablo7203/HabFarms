"use client";
import { useState, useTransition } from "react";
import { voidBirdSaleAction } from "@/app/actions/sales";
export function BirdSaleVoidButton({ saleId }: { saleId: string }) { const [pending,start]=useTransition(); const [message,setMessage]=useState(""); return <div className="mt-5"><button disabled={pending} onClick={()=>{const reason=prompt("Reason for voiding this Bird Sale (at least 3 characters):");if(reason)start(async()=>{const result=await voidBirdSaleAction(saleId,reason);setMessage(result.message)})}} className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700">{pending?"Voiding…":"Void Bird Sale"}</button>{message&&<p role="status" className="mt-2 text-sm">{message}</p>}</div>; }
