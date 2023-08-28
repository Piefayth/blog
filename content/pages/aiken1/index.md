---
title: Aiken for Amateurs
date: 2023-08-27
---


After a couple weeks of research on Cardano, I still struggled to visualize what I could build with smart contracts. The relationship between minting policies and spending validators was unclear, the bridge between Aiken and Lucid seemed complicated, and worst of all, I couldn't figure out where to keep my application state! This is my attempt at the introduction I would've liked to have had myself.


## Prerequisites

This article assumes you have completed the Aiken "Hello, World" tutorial and have read the Cardano developer documentation. Familiarity with native tokens, wallets, addresses, and off-chain infrastructure (e.g. chain indexes) is expected. All the examples within are Deno + TypeScript + Lucid + Aiken. Your environment should be configured to support that.

Some of the imports and boilerplate have been removed from the examples below. Complete, runnable examples are available in [the companion repo to this article](https://github.com/Piefayth/aiken-blog-1-code/tree/main).

## Smart Contracts


Smart contracts on Cardano are _validators_. A smart contract is unable to take any action on its own; it can only approve or deny proposed transactions. A smart contract cannot "send tokens" or "call another contract." The contract must introspect the incoming transaction and verify that it does those things. There are four kinds of contracts, but we'll focus on the two that power most decentralized applications: minting policies and spending validators.


- **Minting Policy**: If a transaction intends to _mint_ new tokens or _burn_ existing tokens, it requires the approval of that token's minting policy to do so.
- **Spending Validator**: If a transaction intends to spend tokens from a contract address, it requires the approval of that address's spending validator.


A contract is identified by a hash of itself. In the case of a minting policy, the hash of the code of the contract is the policy id of the native token that it mints. If you have a token with a particular policy id, it is guaranteed to have been minted by the minting policy that policy id was derived from. If the code of that minting policy were anything else, the resultant policy id would differ, and it _could not_ produce the "same" token. In a similar fashion, for the spending validator, the hash of the code of the contract is (effectively) the address that the contract resides at. In the Aiken "Hello, World" tutorial, looking up the resultant transaction on an indexing service reveals this; there is already a long history of transactions at the contract address you just "made"! Same code? Same contract.

Contracts have limited ability to "look up" on-chain data. When submitting a transaction, nearly all of the data must be provided by the caller. For a single transaction, this includes

- **inputs**: What unspent transaction outputs are being spent?
- **outputs**: What new utxos are being created?
- **mint**: What tokens were minted and burned?
- **signatories**: Who signed it?
- **datums**: The data stored alongside a utxo on-chain.
- **redeemers**: The arguments to a minting policy or spending validator.

> Note that there is also **metadata**. Metadata is data stored on-chain that is _not available in contracts_. A transaction can put metadata on any utxo, but that metadata cannot be consumed by a contract.

Every minting policy and spending validator has access to these fields. Some are self-explanatory, but two deserve special attention, _datum_ and _redeemer_. 

## Minting Policies & Redeemers

Let's introduce minting policies and redeemers with an example. Here is the simplest possible minting policy in Aiken. We know it's a minting policy because it _only_ takes a redeemer - not a datum.

```haskell
use aiken/transaction.{ScriptContext, Redeemer}

validator {
    fn mint_my_cool_token(_redeemer: Redeemer, _ctx: ScriptContext) -> Bool {
        True
    }
}
```

This validator ignores the redeemer completely. Because it always returns `True`, the associated tokens can be minted and burned freely! To mint some of our new token, we can build a transaction with Lucid like this:

```ts
// ... setup lucid, select a wallet ...

const assetName = `${ourMintingPolicyId}${fromText("COOL")}`
const tx = await lucid.newTx()
    .attachMintingPolicy(ourMintingPolicy)
    .mintAssets(
        {
            [assetName]: 10000000000n
        }, 
        Data.void()
    )
    .complete()

// ... sign & submit transaction ... 
```

Submitting such a transaction would mint 10 billion tokens with the name "COOL" under the policy id that has been derived from our validator. Some notable elements are required here.

1. **assetName**: There can be many tokens with different names under a single policy. In order to uniquely identify a specific token with a specific policy, the policy id is concatenated with the hex encoded token name. In this case, we are minting tokens named "COOL".
2. **attachMintingPolicy**: Attaching the entire content of the minting policy script itself is required for every transaction that mints or burns tokens. Attempting to mint an asset that uses a policy id without an associated minting policy in the transaction will result in an error.
3. **mintAssets**: The first argument to mint assets, straightforwardly, is a map of the asset name to be minted to the amount to mint of that asset. The second argument is the _redeemer_, which is the first parameter to the validator we defined above. Since our minting policy ignores the redeemer, we can send anything. But what if it didn't?

Consider a contract that requires the user to know a code word to mint a token. This isn't very secure, since neither the content of your contract nor the redeemer itself is a secret. A guessed word is, however, a great example of the kind of data we couldn't easily access in a standalone minting policy without a redeemer.

```haskell
type CoolTokenRedeemer {
    guessed_word: ByteArray
}

validator {
    fn mint_my_cool_token(redeemer: CoolTokenRedeemer, _ctx: ScriptContext) -> Bool {
        let code_word = "secret"
        redeemer.guessed_word == code_word
    }
}
```

By defining a type for the redeemer, we declare what the validator expects as input: a `guessed word` as a `ByteArray`. In Aiken, strings are just ByteArrays, so both the type and the validation are easy to implement here. If the redeemer includes a `guessed_word` of `"secret"`, the associated transaction may mint or burn whatever amount of tokens it requests.

Things get more exotic with Lucid and TypeScript. Here's an implementation of a transaction that mints from that contract.

```ts
import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts"

const CoolTokenRedeemerSchema = Data.Object({
    guessed_word: Data.Bytes()
})
type CoolTokenRedeemer = Data.Static<typeof CoolTokenRedeemer>
const CoolTokenRedeemer = CoolTokenRedeemerSchema as unknown as CoolTokenRedeemer

// ... setup lucid ...

const assetName = `${ourMintingPolicyId}${fromText("COOL")}`
const tx = await lucid.newTx()
    .attachMintingPolicy(ourMintingPolicy)
    .mintAssets(
        {
            [assetName]: 10000000000n
        }, 
        Data.to(
            { guessed_word: "secret" }, 
            CoolTokenRedeemer
        )
    )
    .complete()

// ... sign & submit transaction ... 
```

An awful lot of extra code just to add a redeemer! There is some boilerplate for representing Aiken types with Lucid and TypeScript, but with good reason. Without using Lucid, types that you represent in Aiken would have to be encoded as order-sensitive JSON with nameless keys. Our instance of `CoolTokenRedeemer` is really just this under the hood:

```json
{
	"constructor": 0,
	"fields": [{
		"bytes": 736563726574
	}]
}
```

Lucid provides the `Data` schema builder to simplify the construction of such JSON structures. Notably, the TypeScript types enforce certain data transformations, like accepting strings for byte fields. We will explore `Data` further, but I recommend keeping the [Data tests in Lucid](https://github.com/spacebudz/lucid/blob/main/tests/data.test.ts) open as a reference when first working with it.

As we've demonstrated, the redeemer gives the caller the ability to react to the state of the contract. Indeed, the only way to make a useful minting policy redeemer at all is by making the contract stateful. In this case, the state is the code word, `"secret"`. Hardcoding our state, however, does not result in a flexible contract. How do we have dynamic state in our contract?

One way you might try to achieve this dynamism is by parameterizing the validator itself.

```haskell
type CoolTokenRedeemer {
    guessed_word: ByteArray
}

validator(code_word: ByteArray) {
    fn mint_my_cool_token(redeemer: CoolTokenRedeemer, _ctx: ScriptContext) -> Bool {
        redeemer.guessed_word == code_word
    }
}
```

In this way, the hardcoded secret can be removed. Running `aiken build` generates `plutus.json` with our script in it, and we can parameterize that script like this:

```ts
import blueprint from "../plutus.json" assert { type: "json" }
import { 
  applyDoubleCborEncoding, 
  applyParamsToScript 
} from "https://deno.land/x/lucid@0.10.7/mod.ts"

const mintCoolToken = blueprint.validators.find(
  v => v.title === "cool.mint_my_cool_token"
)!

const parameterizedMintCoolToken = {
  type: "PlutusV2",
  script: applyDoubleCborEncoding(
    applyParamsToScript(
      guessMintingPolicy.script, [fromText("new secret")]
    )
  )
}

const tx = await lucid.newTx()
    .attachMintingPolicy(parameterizedMintCoolToken)
    .mintAssets(
        {
            [assetName]: 10000000000n
        }, 
        Data.to(
            { guessed_word: fromText("new secret") }, 
            CoolTokenRedeemer
        )
    )
    .complete()
```

This is interesting, because now we can create new contracts in our client applications at runtime. Users could each provide a custom code word and receive a custom minting policy that only works with the word they've chosen. But this has a potentially fatal flaw: the tokens minted by each user will have a unique policy id. They _aren't the same token_. In certain cases, like creating a gift card, that can be desirable - a policy mints a single gift card for a single payment by a single user. In our case, all this means is we aren't any closer to having dynamic state! We're exactly where we were before. Each unique minting policy has a single, hardcoded code word; we just have many policies now.

So, really, how do we store state on-chain?

## Spending Validators & Datums

Suppose we want to create a minting policy that only allows a certain number of tokens to be in circulation. Say, at most, 1,000,000 tokens. Once that minting cap has been reached, they can be burned, at which point it should be possible to mint more. How can the minting policy know how many tokens are in circulation? This information is easy to get off-chain through [Blockfrost](https://blockfrost.io/) or [cardano-db-sync](https://github.com/input-output-hk/cardano-db-sync/tree/master), but the minting policy alone has no mechanism to prove that a submitted value from these sources has not been manipulated. Mechanically, we could accept it as a redeemer value, but there's no sense; the user submitting the transaction could provide _any_ value, and there's no ground truth to check the submission against.

To do this, we need _validated_ and _dynamic_ state that can be accessed in a contract and is resilient to malicious updates. Spending validators, our second kind of contract, have this luxury via the _datum_.

A datum is optional, arbitrary data that is stored alongside a utxo. When sending assets to an address, a transaction author can include in each output whatever datum and whatever assets they like. There is no such thing as a "receive" validator. Our spend validator will, as the name suggests, only execute when a utxo is _spent_ from the contract address. 

Since a single address can have many utxos, it can also contain many datums. As such, there is not naturally a single datum that contains the global state of the contract address. Every unspent output at the address is independently subject to the terms of spending that are enforced by the spending validator. 

Here's a variant of the Hello World example from the Aiken tutorial. This spending validator accepts arbitrarily-valued utxos that contain a datum with an `owner`'s verification key, and only allows those utxos to be spent in transactions signed by that same owner.

```haskell
use aiken/transaction.{
    InlineDatum,
    ScriptContext, 
    Redeemer, 
    Spend,
    find_input
}
use aiken/list
use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction/credential.{VerificationKey}

type VerificationKeyHash =
  Hash<Blake2b_224, VerificationKey>

type OwnerDatum {
    owner: VerificationKeyHash
}

validator {
  fn only_for_owner(
      _datum: Data, 
      _redeemer: Redeemer,
      ctx: ScriptContext
  ) -> Bool {
    let ScriptContext { transaction, purpose } = ctx
    expect Spend(spent_utxo_reference) = purpose
    expect Some(input) = find_input(
        transaction.inputs, 
        spent_utxo_reference
    )

    expect InlineDatum(maybe_owner_datum) = input.output.datum
    expect owner_datum: OwnerDatum = maybe_owner_datum

    list.has(transaction.extra_signatories, owner_datum.owner)
  }
}
```

Destructuring the `ScriptContext` gives us access to a `Transaction`. The Aiken docs have [a complete description of the fields available within the transaction](https://aiken-lang.github.io/stdlib/aiken/transaction.html#Transaction), but, in this case, we are interested in the `inputs` and the `extra_signatories`. This validator searches the transaction `inputs` to find the utxo that is being spent from the contract address. It expects an inline `OwnerDatum` to exist on that utxo. Finally, it checks that the transaction was signed by the owner defined in the datum.


Let's lock funds into the contract. 

```ts
import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts"

// ... setup Lucid, select a wallet ...
const owner = lucid.utils.getAddressDetails(
  recipientAddress
).paymentCredential!.hash
const datum: OwnerDatum = { owner }

const tx = await lucid.newTx()
  .payToAddressWithData(
    contractAddress,
    {
      inline: Data.to(datum, OwnerDatum)
    },
    {
      lovelace: 50000000n,
    }
  )
  .complete()
```

This is just a call to **payToAddressWithData**. Our transaction has a single operation: a payment of 50 ADA to the contract address. It's important that this transaction includes a _valid_ datum. The contract will not execute until the utxo is _spent_, so the contents of this send are completely unvalidated. It will always succeed, even if the datum is erroneous! For simplicity, we are having the same wallet both store and retrieve the ADA, but this deposit could have come from anyone, and they could have set any owner in the datum.

Also notice that this is an _inline_ datum. This means that the full content of the datum is stored on-chain, rather than just the hash. We will be using inline datums for convenience, but keep in mind that they do increase transaction size as the amount of data they store increases. [More reading here.](https://cips.cardano.org/cips/cip32/)

Now we must spend the 50 ADA we put into the contract. To do so, search the utxos at the contract address for the deposit that was just made, then specify that utxo as an input to the transaction with `collectFrom`. Because this is a spend from a script address, a redeemer _must_ be provided to `collectFrom`. Failure to do so will result in a confusing `Error: Missing script witness`. The value of the redeemer is irrelevant in our validator, so we can pass `Data.void()` as an empty redeemer input.

```ts
const contractUtxos = await lucid.utxosAt(contractAddress)
const depositUtxo = contractUtxos.find(
  txo => txo.txHash === depositTxHash
)!

const withdrawlTx = await lucid.newTx()
    .collectFrom(
        [depositUtxo],
        Data.void()
    )
    .attachSpendingValidator(ownerValidator)
    .addSigner(recipientAddress)
    .complete()

const withdrawlSigned = await withdrawlTx.sign().complete()
const withdrawlTxHash = await withdrawlSigned.submit()
```

Like with the minting policy, the entire spending validator needs to be included within the transaction via `attachSpendingValidator`. Additionally, the signatory requirement must be explicitly specified in the transaction via `addSigner`. Unlike a normal spend from a wallet address, the contract's reliance on the `owner` signature can not be inferred by Lucid.

So the funds have been successfully retrieved from the contract. This means that the utxo containing our `OwnerDatum` has been spent, and that data is no longer accessible from within a contract. It could be retrieved off-chain, but only unspent outputs can be inputs to transactions. How, then, can there be persisted on-chain state without making the utxo unspendable? 

Let's implement a counting contract to demonstrate. The contract will enforce that for every spend from the counting address, there is a new output back to the address that increments the count.

```haskell
validator {
  type CountDatum {
    owner: VerificationKeyHash,
    count: Int
  }

  fn count(
      _datum: Data, 
      _redeemer: Redeemer,
      ctx: ScriptContext
  ) -> Bool {
    let ScriptContext { transaction, purpose } = ctx
    expect Spend(spent_utxo_reference) = purpose
    expect Some(input) = find_input(
        transaction.inputs, 
        spent_utxo_reference
    )

    expect InlineDatum(maybe_old_count_datum) = input.output.datum
    expect old_count_datum: CountDatum = maybe_old_count_datum

    let count_script_address = input.output.address

    expect Some(output) = transaction.outputs
      |> list.filter(fn (output) {
        output.address == count_script_address
      })
      |> list.head()

    expect InlineDatum(maybe_new_count_datum) = output.datum
    expect new_count_datum: CountDatum = maybe_new_count_datum
    
    and {
      list.has(transaction.extra_signatories, old_count_datum.owner),
      new_count_datum.count == old_count_datum.count + 1,
      new_count_datum.owner == old_count_datum.owner
    }
  }
}
```

This is much like the previous spending validator; we've just added an additional requirement via the `count` field of the datum.  In addition to having permission to spend the utxo at the count script address, the caller must include an output back to the same address that includes an appropriately incremented datum. For simplicity's sake, the contract assumes that there is only a single script output (a single updated count), but it could have been written to support multiple at once. 

Composing the initial transaction is no different than before. Just update the datum type.

```ts
const owner = lucid.utils.getAddressDetails(
  recipientAddress
).paymentCredential!.hash
const count = 0n
const originalDatum: CountDatum = { owner, count }

const depositTx = await lucid.newTx()
  .payToAddressWithData(
    contractAddress,
    {
      inline: Data.to(originalDatum, CountDatum)
    },
    {}
  )
  .complete()
```

Since the asset value being stored here is irrelevant, it can be omitted. Lucid will automatically calculate the minimum amount of ADA required and add it to the transaction outputs from the currently configured wallet. Spending is similar, but not identical, to the last spending validator. This time the contract mandates a spend _back_ to the contract with the updated datum. So in addition to `collectFrom` to initialize the spend, we must include an appropriately parameterized `payToAddressWithData` back to the contract.

```ts
const contractUtxos = await lucid.utxosAt(contractAddress)
const depositUtxo = contractUtxos.find(
  txo => txo.txHash === depositTxHash
)!

const updatedDatum: CountDatum = { owner, count: count + 1n }

const withdrawlTx = await lucid.newTx()
    .collectFrom(
        [depositUtxo],
        Data.void()
    )
    .attachSpendingValidator(countValidator)
    .payToAddressWithData(
      contractAddress,
      { inline: Data.to(updatedDatum, CountDatum)}, 
      {}
    )
    .addSigner(recipientAddress)
    .complete()
```

Success! Let's check the result.

```ts
const countUtxos = await lucid.utxosAt(contractAddress)
console.log(JSON.stringify(countUtxos, null, 2))
```

That gives us a datum `d8799f581cac8f9db1a45ce3ed263aac3fa022e82705d190e3e31dd963ee295a4701ff`. Plugging that into the [datum decoder](https://cardanoscan.io/datumInspector?datum=d8799f581cac8f9db1a45ce3ed263aac3fa022e82705d190e3e31dd963ee295a4701ff) gives us the expected data. `count`, the second field, has been incremented by 1.

```js
{
   constructor: 0,
   fields: [
      {
         bytes: "ac8f9db1a45ce3ed263aac3fa022e82705d190e3e31dd963ee295a47"
      },
      {
         int: 1
      }
   ]
}
```


To ensure the validator is working properly, we can try updating the datum incorrectly, like so:

```ts
const updatedDatum: CountDatum = { owner, count: count + 2n }
```

That results in an expected failure.

```
Uncaught (in promise) "Redeemer (Spend, 0): 
The provided Plutus code called 'error'
```

Now we have validated, persistent on-chain state that we can consume in a contract! That's exciting, but...

## All Together Now
Unfortunately, there is a glaring vulnerability in our approach. What if the first transaction sent to the count script address looked like this?

```ts
const count = 9999999n
const datum: CountDatum = { owner, count }

const depositTx = await lucid.newTx()
  .payToAddressWithData(
    contractAddress,
    {
      inline: Data.to(datum, CountDatum)
    },
    {}
  )
  .complete()
```

Since this initial send to the contract address does not trigger the spending validator, we can make no guarantees about its authenticity! A caller can easily spoof arbitrarily high counts. If we are trying to build a trustless protocol from our contracts, this is a problem. How do you validate a "new" output to the contract address?

One interesting property of minting policies is that they produce utxos without consuming any inputs. This means that if we can prove a utxo was created with the permission of a particular minting policy, we can know - in a guaranteed and trustless way - that the initial state of the datum on that utxo is valid. This "proof" can be provided in the form of an NFT minted and placed on the utxo. The minting policy will validate that the NFTs are only ever created at our count script address, and the count contract will verify that the NFTs are never spent to an address other than the contract's own. In this way, we can be confident that any transaction output that contains this "authorizing" NFT was formed per the rules of our contract.

Let's break that down and implement it. Remember to check the full code for the [script](https://github.com/Piefayth/aiken-blog-1-code/blob/main/validators/secure_count.ak) and [validator](https://github.com/Piefayth/aiken-blog-1-code/blob/main/scripts/secure_count.ts) as needed. There are three core logical checks that the minting policy must do.

1. Check that this transaction does not spend an existing count datum. This isn't a technical restriction; it is possible to both update an existing count datum in the same transaction that new one is created. This is merely a simplification we are performing to reduce the complexity of the contract.
2. Check that each newly created utxo contains a properly formed datum.
3. Make sure only one NFT is minted per new count datum. If it were possible to mint extra NFTs, they could, in future transactions, be sent to arbitrary addresses without being checked by the minting policy. This would allow for forged datums by spending an NFT into the count contract without applying the minting policy!

Here's an outline of our validator.

```haskell
type CountDatum {
    owner: VerificationKeyHash,
    authorizing_policy: ScriptHash,
    count: Int
}

validator(count_script_hash: ByteArray) {
  fn count_authorizer(      
      _redeemer: Redeemer,
      ctx: ScriptContext
  ) {
    let ScriptContext { transaction, purpose } = ctx
    let Transaction { inputs, outputs, mint, .. } = transaction
    expect Mint(policy_id) = purpose

    let authorizing_token_name = "COUNT"

    expect no_count_data_in_inputs(inputs, count_script_hash)

    let new_count_outputs = find_script_outputs(outputs, count_script_hash)

    expect no_invalid_count_data(
      transaction,
      new_count_outputs, 
      authorizing_token_name, 
      policy_id
    )

    let num_minted = mint 
        |> value.from_minted_value
        |> quantity_of(policy_id, authorizing_token_name)

    list.length(new_count_outputs) == num_minted
  } 
}
```

There is a new field in our datum: `authorizing_policy`. Because this minting policy is parameterized by the `count_script_hash`, we can not, in turn, parameterize the count script itself with the minting policy id. Doing so would create a circular dependency. To handle that, the `policy_id` is assigned to a field of the datum and validated in the minting transaction. That `policy_id` can then be consumed in the spending validator.

Checks #1 and #2 have been factored into the functions `no_count_data_in_inputs` and `no_invalid_count_data` respectively. For the former, we can leverage the built-in `find_script_outputs`. Given a list of outputs, this function will return only outputs that are to a particular script. If that list is empty, we can be sure that this transaction does not include any spends from the count script address.

```haskell
fn no_count_data_in_inputs(
  inputs: List<Input>, 
  count_script_hash: ScriptHash
) -> Bool {
  list.map(inputs, fn (input){
      input.output
  })
  |> find_script_outputs(count_script_hash)
  |> list.is_empty()
}
```

Afterwards, the outputs to the count script address must be verified with `no_invalid_count_data`. There are several conditions to check.

```haskell
fn no_invalid_count_data(
  transaction: Transaction,
  script_outputs: List<Output>, 
  authorizing_token_name: ByteArray,
  policy_id: ScriptHash
) -> Bool {
  list.all(script_outputs, fn (output) {
    expect InlineDatum(maybe_new_count_datum) = output.datum

    expect new_count_datum: CountDatum = maybe_new_count_datum
    
    let has_exactly_one_authorizing_nft = 
      1 == quantity_of(output.value, policy_id, authorizing_token_name)

    and {
      list.has(transaction.extra_signatories, new_count_datum.owner),
      has_exactly_one_authorizing_nft,
      new_count_datum.count == 0,
      new_count_datum.authorizing_policy == policy_id
    }
  })
}
```

This checks that

1. The datum is the right shape
2. There is one and only one NFT from this minting policy in each output
3. Each output is signed by its owner
4. The datum has appropriate values for a new count datum (i.e. 0)

Our final check validates that no extra NFTs from this policy were minted. Our previous checks guarantee that there is no more than one NFT per output, and no pre-existing NFTs in the input, so checking that the amount minted is equal to the number of script outputs is sufficient here.

```haskell
let num_minted = mint 
    |> value.from_minted_value
    |> quantity_of(policy_id, authorizing_token_name)

list.length(new_count_outputs) == num_minted
```

With the minting policy defined, it is possible to create a utxo at the count contract address with our validated initial datum. Note that in addition to minting the authorizing NFT, the NFT must be explicitly paid to the contract address. 

```ts
const countMintingPolicyId = lucid.utils.validatorToScriptHash(parameterizedCountMintingPolicy)
const contractAddress = lucid.utils.validatorToAddress(secureCountValidator)

const count = 0n
const originalDatum: CountDatum = { 
    owner, 
    count, 
    authorizing_policy: countMintingPolicyId
}

const authorizingNFTName = `${countMintingPolicyId}${fromText("COUNT")}`

const initializingTx = await lucid.newTx()
    .attachMintingPolicy(parameterizedCountMintingPolicy)
    .mintAssets(
        {
            [authorizingNFTName]: 1n,
        }, 
        Data.void()
    )
    .payToAddressWithData(
        contractAddress,
        {
            inline: Data.to(originalDatum, CountDatum)
        },
        {
            [authorizingNFTName]: 1n
        }
    )
    .addSigner(recipientAddress)
    .complete()
```

Now the state of our initial datum for the counting validator is guaranteed by the minting policy. Back in the count spending validator, two additional checks are required.

1. The input being spent from the count script address holds an authorizing NFT.
2. The output being created with the updated count also holds the authorizing NFT.

Both checks are effectively the same logic.

```haskell
fn output_has_authorizing_nft(
  output: Output, 
  authorizing_policy: ScriptHash, 
) {
  let authorizing_token_name = "COUNT"

  1 == quantity_of(
    output.value, 
    authorizing_policy, 
    authorizing_token_name
  )
}
```

Using this, we can add a few new assertions to the `count` spending validator...

```haskell
validator {
  fn count(
      _datum: Data, 
      _redeemer: Redeemer,
      ctx: ScriptContext
  ) -> Bool {
    -- ... snip ...

    expect output_has_authorizing_nft(
      input.output, 
      old_count_datum.authorizing_policy
    )

    -- ... snip ...

    expect output_has_authorizing_nft(
      output, 
      old_count_datum.authorizing_policy
    )

    and {
    -- ... snip ...
      new_count_datum.authorizing_policy == old_count_datum.authorizing_policy
    }
  }
}
```

With the minting policy for the authorizing NFT in place, and the spending validator updated, we can now have a stateful count datum that is guaranteed to play by the rules we've defined! Let's perform an update on our new count validator to make sure.

```ts
const contractUtxos = await lucid.utxosAt(contractAddress)
const countUtxo = contractUtxos.find(txo => txo.txHash === initializingTxHash)!

const updatedDatum: CountDatum = { 
    ...originalDatum,
    count: originalDatum.count + 1n
}

const updateCountTx = await lucid.newTx()
    .collectFrom(
        [countUtxo],
        Data.void()
    )
    .attachSpendingValidator(secureCountValidator)
    .payToAddressWithData(
      contractAddress,
      { inline: Data.to(updatedDatum, CountDatum)}, 
      {
        [authorizingNFTName]: 1n
      }
    )
    .addSigner(recipientAddress)
    .complete()
```

There's nothing in this transaction that we haven't done before by now. Most importantly, the outputs include the forwarding of the original authorizing NFT. 

At last, the result can be verified:

```ts
const countUtxos = await lucid.utxosAt(contractAddress)
console.log(JSON.stringify(countUtxos, null, 2))
```

Decoding resultant datum confirms that our updated count spending validator works! Now, if other contracts wanted to leverage this "count" value, they can do so, knowing that its integrity will remain intact.

## What's Next?

Now that we understand the relationship between minting policies and spending validators, we can use these primitives to start composing decentralized, trustless protocols on top of Cardano! Please reach out to me on GitHub or Discord if this content was helpful for you or you would like to read more posts like it. Are there other Aiken or Cardano topics you'd like explored? Let me know!

---

Homework:

1. The count spending validator [assumes that there is only a single count being updated](https://github.com/Piefayth/aiken-blog-1-code/blob/main/validators/secure_count.ak#L54-L59). Modify the validator and the transaction that calls it to support updating multiple count datums at once. 

2. The minting policy for the authorizing NFTs leveraged by the count spending validator [disallows updates of existing count data during transactions that include a mint](https://github.com/Piefayth/aiken-blog-1-code/blob/main/validators/secure_count.ak#L102). Modify the validator to support doing both in one transaction. What needs to change for you to be able to identify which output belongs with which input (if any)?

