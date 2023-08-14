(namespace (read-msg 'ns))

(module policy-manager GOVERNANCE

  (defcap GOVERNANCE ()
    (enforce-guard "marmalade-v2.marmalade-admin"))

  (use kip.token-policy-v2 [token-info])
  (use util.fungible-util)
  (use marmalade-v2.quote-manager)
  (use marmalade-v2.quote-manager [quote-spec quote-msg fungible-account])

  (defconst QUOTE-MSG-KEY:string "quote"
    @doc "Payload field for quote spec")

  (defconst BUYER-FUNGIBLE-ACCOUNT-MSG-KEY "buyer_fungible_account"
    @doc "Payload field for buyer's fungible account")

  (defcap POLICY_MANAGER:bool ()
    @doc "Ledger module guard for policies to be able to validate access to policy operations."
    true
  )

  (defcap ESCROW (sale-id:string)
    @doc "Capability to be used as escrow's capability guard"
    true
  )

  (defun get-escrow-account:object{fungible-account} (sale-id:string)
    { 'account: (create-principal (create-capability-guard (ESCROW sale-id)))
    , 'guard: (create-capability-guard (ESCROW sale-id))
    })

  (defun policy-manager-guard:guard ()
    (create-capability-guard (POLICY_MANAGER))
  )

  ;; Saves ledger guard information
  (defschema ledger
    ledger-guard:guard
  )

  (deftable ledgers:{ledger}
    @doc "Singleton table for ledger guard storage")

  (defun enforce-ledger:bool ()
    @doc "Enforces that function is called from the saved ledger"
    (with-read ledgers "" {
      "ledger-guard":= ledger-guard
      }
      (enforce-guard ledger-guard)
    )
  )

  (defun init:bool(ledger-guard:guard)
    @doc "Must be initiated with ledger information"
    (with-capability (GOVERNANCE)
      (insert ledgers "" {
        "ledger-guard": ledger-guard
      })
    )
    true
  )

  ;; Saves Concrete policy information
  (defschema concrete-policy
    policy:module{kip.token-policy-v2}
  )

  (defcap CONCRETE_POLICY:bool (policy-field:string policy:module{kip.token-policy-v2})
    @event
    true
  )

  (deftable concrete-policies:{concrete-policy})

  (defconst NON_FUNGIBLE_POLICY:string 'non-fungible-policy )
  (defconst ROYALTY_POLICY:string 'royalty-policy )
  (defconst COLLECTION_POLICY:string 'collection-policy )
  (defconst GUARD_POLICY:string 'guard-policy )
  (defconst CONCRETE_POLICY_LIST:[string]
    [NON_FUNGIBLE_POLICY ROYALTY_POLICY COLLECTION_POLICY GUARD_POLICY] )

  (defun write-concrete-policy:bool (policy-field:string policy:module{kip.token-policy-v2})
    (contains policy-field CONCRETE_POLICY_LIST)
    (with-capability (GOVERNANCE)
      (write concrete-policies policy-field {
        "policy": policy
        }
      )
      (emit-event (CONCRETE_POLICY policy-field policy))
    true)
  )

  (defun get-concrete-policy:module{kip.token-policy-v2} (policy-field:string)
    (with-read concrete-policies policy-field {
      "policy":= policy
      }
      policy)
  )

  ;; Capbilities to guard internal functions

  (defcap OFFER:bool
    ( sale-id:string
    )
    @doc "Capability to grant internal transaction inside OFFER"
    true
  )

  (defcap BUY:bool
    ( sale-id:string
    )
    @doc "Capability to grant internal transaction inside BUY"
    true
  )

  (defcap WITHDRAW:bool
    ( sale-id:string
    )
    @doc "Capability to grant internal transaction inside WITHDRAW"
    true
  )


  ;; Map list of policy functions

  (defun enforce-init:[bool]
    (token:object{token-info})
    (enforce-ledger)
    (with-capability (POLICY_MANAGER)
      (map-init token (at 'policies token))
    )
  )

  (defun enforce-mint:[bool]
    ( token:object{token-info}
      account:string
      guard:guard
      amount:decimal
    )
    (enforce-ledger)
    (with-capability (POLICY_MANAGER)
      (map-mint token account guard amount (at 'policies token))
    )
  )

  (defun enforce-burn:[bool]
    ( token:object{token-info}
      account:string
      amount:decimal
    )
    (enforce-ledger)
    (with-capability (POLICY_MANAGER)
      (map-burn token account amount (at 'policies token))
    )
  )

  (defun enforce-offer:[bool]
    ( token:object{token-info}
      seller:string
      amount:decimal
      sale-id:string )
    @doc " Executed at `offer` step of marmalade.ledger.                             \
    \ Required msg-data keys:                                                        \
    \ * (optional) quote:object{quote-msg} - sale is registered as a quoted fungible \
    \ sale if present. If absent, sale proceeds without quotes."
    (enforce-ledger)
    (enforce-sale-pact sale-id)
    (with-capability (POLICY_MANAGER)
      ;;Check if quote-msg exists
      (if (exists-msg-quote QUOTE-MSG-KEY)
        ;;true - insert quote message
        (add-quote sale-id (at 'id token) (read-msg QUOTE-MSG-KEY))
        ;;false - skip
        true)
        (map-offer token seller amount sale-id (at 'policies token))))

  (defun enforce-withdraw:[bool]
    ( token:object{token-info}
      seller:string
      amount:decimal
      sale-id:string )
    @doc " Executed at `withdraw` step of marmalade.ledger."
    (enforce-ledger)
    (enforce-sale-pact sale-id)
    (with-capability (POLICY_MANAGER)

    (if (exists-quote sale-id)
      [
        (let* (
          (quote (get-quote-info sale-id))
          (reserved (at 'reserved quote)))
          (enforce (= "" reserved) "Sale is reserved, unable to withdraw")
          (map-withdraw token seller amount sale-id (at 'policies token))
        )
      ]
      ;; quote is not used
      (map-withdraw token seller amount sale-id (at 'policies token))
    )))

  (defun enforce-buy:[bool]
    ( token:object{token-info}
      seller:string
      buyer:string
      buyer-guard:guard
      amount:decimal
      sale-id:string )
      @doc " Executed at `buy` step of marmalade.ledger.                                 \
      \ Required msg-data keys:                                                          \
      \ * (optional) buyer_fungible_account:string - The fungible account of the buyer   \
      \ which transfers the fungible to the escrow account. Only required if the sale is \
      \ a quoted sale. "
    (enforce-ledger)
    (enforce-sale-pact sale-id)
    (with-capability (POLICY_MANAGER)
        ;; Checks if quote is saved at offer
        (if (exists-quote sale-id)
          ;; quote is used
          [
            (let* (
              (quote (get-quote-info sale-id))
              (spec:object{quote-spec} (at 'spec quote))
              (price:decimal (at 'price spec)))

              ;; Checs if price is final
              (enforce (> price 0.0) "Price must be finalized before buy")
              (map-escrowed-buy sale-id token seller buyer buyer-guard amount (at 'policies token))
            )
          ]
          ;; quote is not used
          (map-buy token seller buyer buyer-guard amount sale-id (at 'policies token))
        )
  ))

  (defun enforce-transfer:[bool]
    ( token:object{token-info}
      sender:string
      guard:guard
      receiver:string
      amount:decimal )
    (enforce-ledger)
    (with-capability (POLICY_MANAGER)
      (map-transfer token sender guard receiver amount (at 'policies token))))


;; Sale/Escrow Functions
  (defcap SALE_RESERVED:bool
    ( sale-id:string
      price:decimal
      buyer:string
      buyer-guard:guard
    )
    @event
    true
  )

  (defun enforce-sale-pact:bool (sale:string)
    "Enforces that SALE is id for currently executing pact"
    (enforce (= sale (pact-id)) "Invalid pact/sale id")
  )

  (defun reserve-sale:bool (
    sale-id:string
    price:decimal
    buyer:string
    buyer-guard:guard
    quote-account:string
    )
    @doc "Reserves the token for buyer and transfers funds"

    (enforce (> price 0.0) "price must be positive")
    (enforce-reserved buyer buyer-guard)

    (with-capability (POLICY_MANAGER)
      ; Update the quote in the quote-manager
      (update-quote-price sale-id price buyer)
    )

    (let* (
      (escrow-account:object{fungible-account} (get-escrow-account sale-id))
      (quote (get-quote-info sale-id))
      (spec:object{quote-spec} (at 'spec quote))
      (fungible:module{fungible-v2} (at 'fungible spec))
      (amount:decimal (at 'amount spec))
      (sale-price:decimal (floor (* price amount) (fungible::precision))))

      ; Transfer buy-amount to escrow account
      (install-capability (fungible::TRANSFER quote-account (at 'account escrow-account) sale-price))
      (fungible::transfer-create quote-account (at 'account escrow-account) (at 'guard escrow-account) sale-price)

      (emit-event (SALE_RESERVED sale-id price buyer buyer-guard))
    )
  )

  (defun map-escrowed-buy:bool
    ( sale-id:string
      token:object{token-info}
      seller:string
      buyer:string
      buyer-guard:guard
      amount:decimal
      policies:[module{kip.token-policy-v2}]
    )
    (let* (
           (escrow-account:object{fungible-account} (get-escrow-account sale-id))
           (quote:object{quote-schema} (get-quote-info sale-id))
           (reserved-buyer:string (at 'reserved quote))
           (spec:object{quote-spec} (at 'spec quote))
           (fungible:module{fungible-v2} (at 'fungible spec))
           (buyer-fungible-account-name:string (read-msg BUYER-FUNGIBLE-ACCOUNT-MSG-KEY))
           (seller-fungible-account:object{fungible-account} (at 'seller-fungible-account spec))
           (price:decimal (at 'price spec))
           (sale-price:decimal (floor (* price amount) (fungible::precision)))
      )

       (if (= reserved-buyer "")
        ; No reserved buyer, transfer from buyer to escrow
        (fungible::transfer-create buyer-fungible-account-name (at 'account escrow-account) (at 'guard escrow-account) sale-price)
        ; Reserved buyer, escrow has already been funded
        (enforce (= reserved-buyer buyer) "Reserved buyer must be buyer")
       )

       (with-capability (ESCROW sale-id)
         ;; Run policies::enforce-buy
         (map-buy token seller buyer buyer-guard amount sale-id policies)
         ;; Transfer Escrow account to seller
         (let (
               (balance:decimal (fungible::get-balance (at 'account escrow-account)))
             )
             (install-capability (fungible::TRANSFER (at 'account escrow-account) (at 'account seller-fungible-account) balance))
             (fungible::transfer (at 'account escrow-account) (at 'account seller-fungible-account) balance)
         )
       )
       true
    )
  )

  ;;utility functions

  (defun exists-quote:bool (sale-id:string)
    @doc "Looks up quote table for quote"
    (try false (let ((q (get-quote-info sale-id))) true))
  )

  (defun exists-msg-decimal:bool (msg:string)
    @doc "Checks env-data field and see if the msg is a decimal"
    (let  ((d:decimal (try -1.0 (read-decimal msg))))
      (!= d -1.0))
  )

  (defun exists-msg-quote:bool (msg:string)
    @doc "Checks env-data field and see if the msg is a object"
    (let ((o:object (try {} (read-msg msg))))
      (!= o {}))
  )

 (defun token-init (token:object{token-info} policy:module{kip.token-policy-v2})
  (policy::enforce-init token))

 (defun map-init (token:object{token-info} policy-list:[module{kip.token-policy-v2}])
  (map (token-init token) policy-list))

 (defun token-mint (token:object{token-info} account:string guard:guard amount:decimal policy:module{kip.token-policy-v2})
  (policy::enforce-mint token account guard amount))

 (defun map-mint (token:object{token-info} account:string guard:guard amount:decimal policy-list:[module{kip.token-policy-v2}])
  (map (token-mint token account guard amount) policy-list))

 (defun token-burn (token:object{token-info} account:string amount:decimal policy:module{kip.token-policy-v2})
  (policy::enforce-burn token account amount))

 (defun map-burn (token:object{token-info} account:string amount:decimal policy-list:[module{kip.token-policy-v2}])
  (map (token-burn token account amount) policy-list))

 (defun token-offer (token:object{token-info} account:string amount:decimal sale-id:string policy:module{kip.token-policy-v2})
  (policy::enforce-offer token account amount sale-id))

 (defun map-offer (token:object{token-info} account:string amount:decimal sale-id:string policy-list:[module{kip.token-policy-v2}])
  (map (token-offer token account amount sale-id) policy-list))

  (defun token-withdraw (token:object{token-info} account:string amount:decimal sale-id:string policy:module{kip.token-policy-v2})
   (policy::enforce-withdraw token account amount sale-id))

  (defun map-withdraw (token:object{token-info} account:string amount:decimal sale-id:string policy-list:[module{kip.token-policy-v2}])
   (map (token-withdraw token account amount sale-id) policy-list))

 (defun token-buy (token:object{token-info} seller:string buyer:string buyer-guard:guard amount:decimal sale-id:string policy:module{kip.token-policy-v2})
  (policy::enforce-buy token seller buyer buyer-guard amount sale-id))

 (defun map-buy:[bool] (token:object{token-info} seller:string buyer:string buyer-guard:guard amount:decimal sale-id:string policy-list:[module{kip.token-policy-v2}])
  (map (token-buy token seller buyer buyer-guard amount sale-id) policy-list))

 (defun token-transfer (token:object{token-info} sender:string guard:guard receiver:string amount:decimal policy:module{kip.token-policy-v2})
  (policy::enforce-transfer  token sender guard receiver amount))

 (defun map-transfer (token:object{token-info} sender:string guard:guard receiver:string amount:decimal policy-list:[module{kip.token-policy-v2}])
  (map (token-transfer  token sender guard receiver amount) policy-list))
)

(if (read-msg 'upgrade )
  ["upgrade complete"]
  [ (create-table ledgers)
    (create-table concrete-policies)
  ])
