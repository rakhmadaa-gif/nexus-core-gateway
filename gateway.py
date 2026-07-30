from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import os
import stripe
import requests
from supabase import create_client, Client

app = FastAPI(title="NEXUS-Core Gateway V1.0")

# ENV
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
stripe.api_key = STRIPE_SECRET_KEY

# 1. ENDPOINT CEK SALDO
@app.get("/api/cek-saldo")
def cek_saldo(customer_id: str):
    res = supabase.table("customers").select("asi_balance").eq("customer_id", customer_id).single().execute()
    if not res.data: raise HTTPException(404, "Customer tidak ditemukan")
    return {"customer_id": customer_id, "sisa_asi": res.data["asi_balance"], "status": "aktif"}

# 2. ENDPOINT UTAMA - SATPAM
@app.post("/api/verify-and-run")
async def verify_and_run(request: Request):
    body = await request.json()
    customer_id = body.get("customer_id")
    
    # Cek & Potong Kuota
    res = supabase.table("customers").select("asi_balance").eq("customer_id", customer_id).single().execute()
    if not res.data: raise HTTPException(404, "Customer tidak ditemukan")
    
    saldo = res.data["asi_balance"]
    if saldo <= 0: 
        return JSONResponse(status_code=403, content={"status": "rejected", "message": f"Kuota ASI habis. Sisa: {saldo}"})
        
    # Potong 1
    supabase.table("customers").update({"asi_balance": saldo - 1}).eq("customer_id", customer_id).execute()
    
    # Disini nanti tugasnya diteruskan ke agen
    return {"status": "approved", "message": "Tugas diproses agen", "sisa_asi": saldo - 1}

# 3. WEBHOOK STRIPE
@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except: raise HTTPException(400, "Invalid signature")
        
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        customer_email = session["customer_details"]["email"]
        customer_id = session["customer"]
        
        # Isi 25 ASI
        supabase.table("customers").upsert({
            "customer_id": customer_id, 
            "email": customer_email, 
            "asi_balance": 25
        }).execute()
        
        # Kirim email - isi sendiri pake Gmail API
        # send_email(customer_email, customer_id)
        
    return {"status": "success"}