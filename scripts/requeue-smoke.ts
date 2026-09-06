import { createWorkerPool } from "../worker/src/xhs-db.js";
const pool=createWorkerPool(process.env as never);
const id="d464d447-3d44-4c0c-a374-85b1abf60837";
const r=await pool.query("update private.jobs set status='queued',stage='queued',terminal=false,progress=0,locked_by=null,lock_expires_at=null,message_code='JOB_REQUEUED',error_code=null,error_message=null,completed_at=null,run_after=now() where id=$1 returning id,status",[id]);
console.log(JSON.stringify(r.rows)); await pool.end();