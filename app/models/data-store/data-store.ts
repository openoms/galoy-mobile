import { Instance, SnapshotOut, types, flow, getParentOfType, getEnv } from "mobx-state-tree"
import { AccountType, CurrencyType, FirstChannelStatus } from "../../utils/enum"
import {
  Side,
  IQuoteResponse,
  IQuoteRequest,
  IBuyRequest,
  Onboarding,
  OnboardingRewards,
} from "types"
import { parseDate } from "../../utils/date"
import KeychainAction from "../../utils/keychain"
import { generateSecureRandom } from "react-native-securerandom"

import auth from "@react-native-firebase/auth"
import functions from "@react-native-firebase/functions"
import firestore from "@react-native-firebase/firestore"
import { toHex, shortenHash } from "../../utils/helper"

import DeviceInfo from "react-native-device-info"
import Config from "react-native-config"
import { Notifications } from "react-native-notifications"
import { RootStoreModel } from "../root-store"
import { difference } from "lodash"
import { sleep } from "../../utils/sleep"
import { translate } from "../../i18n"
import { currentScreen } from "../../utils/navigation"

// FIXME add as a global var
DeviceInfo.isEmulator().then(isEmulator => {
  if (isEmulator) {
    functions().useFunctionsEmulator("http://localhost:5000")
  }
})

export const OnChainTransactionModel = types.model("OnChainTransaction", {
  txHash: types.string,
  amount: types.number,
  numConfirmations: types.maybe(types.number), // not sure why it's only set for some of them
  blockHash: types.maybe(types.string), // some mined transactions are not
  blockHeight: types.maybe(types.number), // included here
  timeStamp: types.number,
  destAddresses: types.array(types.string),
  totalFees: types.maybe(types.string), //only set for sending transaction
  rawTxHex: types.string,
})

export const PaymentModel = types.model("Payment", {
  paymentHash: types.string,
  valueSat: types.number,
  feeSat: types.maybe(types.number),
  creationDate: types.number,
  path: types.array(types.string),
  status: types.number, // FIXME should be number
  paymentRequest: types.string,
  paymentPreimage: types.string,
  description: types.maybe(types.string),
})

export const HTLCModel = types.model("HTLC", {
  chanId: types.union(types.string, types.undefined, types.number, types.null),
  // htlcIndex: types.maybe(types.union(types.string, types.undefined, types.number)),
  amtMsat: types.union(types.string, types.undefined, types.number, types.null),
  acceptHeight: types.union(types.string, types.undefined, types.number, types.null),
  acceptTime: types.union(types.string, types.undefined, types.number, types.null),
  resolveTime: types.union(types.string, types.undefined, types.number, types.null),
  expiryHeight: types.union(types.string, types.undefined, types.number, types.null),
  state: types.union(types.string, types.undefined, types.number, types.null),
  mppTotalAmtMsat: types.union(types.string, types.undefined, types.number, types.null),
  // mppTotalAmtMsat: types.maybe(types.string),
  customRecords: types.maybe(types.string),
})

export const InvoiceModel = types.model("Invoice", {
  memo: types.maybe(types.string),
  receipt: types.maybe(types.string),
  rPreimage: types.string,
  rHash: types.string,
  value: types.maybe(types.number), // for amountless invoices
  settled: types.maybe(types.boolean),
  state: types.maybe(types.number), //XXX FIXME
  creationDate: types.number,
  expiry: types.maybe(types.number),
  settleDate: types.maybe(types.number),
  paymentRequest: types.maybe(types.string),
  private: types.maybe(types.boolean),
  amtPaidSat: types.maybe(types.number),
  htlcs: types.array(HTLCModel),
  // under htlcs but not in array: mppTotalAmtMsat: types.maybe(types.string),

  // many other fields are not copied
})

export const PendingChannelModel = types.model("Channel", {
  // [
  //   "pendingChannels:",
  //   {
  //     "pendingOpenChannels": [
  //       {
  //         "channel": {
  //           "remoteNodePub": "029fd0834277b92b6ae1b4afd771f74a2f0e9bbdfc13edcf3e7e3da1590c6fc6d6",
  //           "channelPoint": "65ccfc3bf905c8c139e9c6fdf887e4c1bc53624cf13ce266ce2f1704b7a37732:1",
  //           "capacity": "120000",
  //           "remoteBalance": "119817",
  //           "localChanReserveSat": "1200",
  //           "remoteChanReserveSat": "1200"
  //         },
  //         "commitFee": "183",
  //         "commitWeight": "552",
  //         "feePerKw": "253"
  //       }
  //     ]
  //   }
  // ]

  // channel: types.model({
  remoteNodePub: types.string,
  channelPoint: types.string,
  capacity: types.number,
  remoteBalance: types.number,
  localChanReserveSat: types.number,
  remoteChanReserveSat: types.number,
  // }),
  // commitFee: types.number,
  // commitWeight: types.number,
  // feePerKw: types.number
})

export const PendingHTLCModel = types.model("PendingHTLC", {
  // TODO
})

export const ChannelModel = types.model("Channel", {
  active: types.maybe(types.boolean),
  remotePubkey: types.string,
  channelPoint: types.string,
  chanId: types.number,
  capacity: types.number,
  remoteBalance: types.number,
  localBalance: types.optional(types.number, 0),
  commitFee: types.number,
  commitWeight: types.number,
  feePerKw: types.number,
  totalSatoshisReceived: types.optional(types.number, 0),
  numUpdates: types.optional(types.number, 0),
  pendingHtlcs: types.optional(types.array(types.undefined), []),
  csvDelay: types.number,
  private: types.boolean,
  chanStatusFlags: types.string,
  localChanReserveSat: types.number,
  remoteChanReserveSat: types.number,
})

export const FiatTransactionModel = types.model("Transaction", {
  name: types.string,
  icon: types.string,
  amount: types.number,
  date: types.number, // TODO: move to timestamp
  cashback: types.maybe(types.number),
})

export const BaseAccountModel = types
  .model("Account", {
    confirmedBalance: 0,
    unconfirmedBalance: 0,
    type: types.enumeration<AccountType>("Account Type", Object.values(AccountType)),
  })
  .views(self => ({
    get balance() {
      return self.confirmedBalance + self.unconfirmedBalance
    },
    get transactions(): Array<typeof TransactionModel> {
      throw new Error("this is an abstract method, need to be implemented in subclass")
    },
  }))

export const QuoteModel = types
  .model("Quote", {
    side: types.union(types.literal("buy"), types.literal("sell")), // Side,
    satPrice: types.maybe(types.number),
    validUntil: types.maybe(types.number), // probably not needed (could be a state in component)
    satAmount: types.maybe(types.number), // probably not needed (could be a state in component)
    signature: types.maybe(types.string),
    invoice: types.maybe(types.string),
  })
  .actions(self => ({
    reset() {
      // TODO there must be better way to do this
      self.satAmount = self.satPrice = self.validUntil = NaN
      self.signature = self.invoice = undefined
    },
  }))

export const ExchangeModel = types
  .model("Exchange", {
    quote: types.optional(QuoteModel, { side: "buy" }),
  })
  .actions(self => {
    const assertTrade = (side: Side): void /* success */ => {
      if (self.quote.side !== side) {
        throw new Error(`trying to ${side} but quote is for ${self.quote.side}`)
      }

      const now = Date.now() / 1000
      if (now > self.quote.validUntil) {
        throw new Error(
          `quote ${self.quote.validUntil} has expired, now is ${now}. ` + `Ask for for a new quote`,
        )
      }
    }

    return {
      quoteLNDBTC: flow(function*({ side, satAmount }) {
        let request: IQuoteRequest = { side }

        if (side === "sell") {
          request["satAmount"] = satAmount
        } else if (side === "buy") {
          const invoice = yield getParentOfType(self, DataStoreModel).lnd.addInvoice({
            value: satAmount,
            memo: "Buy BTC",
            expiry: 30, // seconds
          })
          request["invoice"] = invoice.paymentRequest
        }

        const result = yield functions().httpsCallable("quoteLNDBTC")(request)
        console.tron.log("quoteBTC: ", result)
        self.quote = result.data as IQuoteResponse

        const invoiceJson = yield getParentOfType(self, DataStoreModel).lnd.decodePayReq(
          self.quote.invoice,
        )
        console.tron.log(invoiceJson)

        if (side === "sell") {
          self.quote.satPrice = parseFloat(JSON.parse(invoiceJson.description)["satPrice"])
        }

        self.quote.satAmount = invoiceJson.numSatoshis
        self.quote.validUntil = invoiceJson.timestamp + invoiceJson.expiry
      }),

      buyLNDBTC: flow(function*() {
        try {
          assertTrade("buy")

          const request: IBuyRequest = {
            side: self.quote.side!,
            invoice: self.quote.invoice!,
            satPrice: self.quote.satPrice!,
            signature: self.quote.signature!,
          }

          const result = yield functions().httpsCallable("buyLNDBTC")(request)
          console.tron.log("result BuyLNDBTC", result)
          return result?.data?.success ?? false
        } catch (err) {
          console.tron.error(err.toString())
          throw err
        }
      }),

      sellLNDBTC: flow(function*() {
        try {
          assertTrade("sell")
          console.tron.log(self.quote.invoice)

          const result = yield getParentOfType(self, DataStoreModel).lnd.payInvoice({
            paymentRequest: self.quote.invoice,
          })
          console.tron.log("result SellLNDBTC", result)
          return result
        } catch (err) {
          console.tron.error(err)
          throw err
        }
      }),
    }
  })

export const FiatAccountModel = BaseAccountModel.props({
  type: AccountType.Bank,
  _transactions: types.array(FiatTransactionModel),
})
  .actions(self => {
    const updateTransactions = flow(function*() {
      let uid
      try {
        uid = auth().currentUser.uid
      } catch (err) {
        console.tron.log("can't get auth().currentUser.uid", err)
      }
      try {
        const doc = yield firestore()
          .doc(`users/${uid}`)
          .get()
        self._transactions = doc.data().transactions
      } catch (err) {
        console.tron.error(`not able to update transaction ${err}`)
      }
    })

    const updateBalance = flow(function*() {
      try {
        const result = yield functions().httpsCallable("getFiatBalances")({})
        console.tron.log("balance", result)
        if ("data" in result) {
          self.confirmedBalance = result.data
          // TODO: add unconfirmed balance
        }
      } catch (err) {
        console.tron.error(`can't fetch the balance`, err)
      }
    })
    const update = flow(function*() {
      yield updateBalance()
      yield updateTransactions()
    })

    return { updateBalance, updateTransactions, update }
  })
  .views(self => ({
    get currency() {
      return CurrencyType.USD
    },
    get transactions() {
      return self._transactions.map(tx => ({
        name: tx.name,
        icon: tx.icon,
        amount: tx.amount,
        date: parseDate(tx.date), // FIXME timestamp
        cashback: tx.cashback,
      }))
    },
  }))

export const LndModel = BaseAccountModel.named("Lnd")
  .props({
    type: AccountType.Bitcoin,
    version: "...loading...",

    lndReady: false,
    walletExist: false,
    syncedToChain: false,

    onChainAddress: "",
    pubkey: "",
    network: "",
    blockHeight: 0,
    error: "",

    lastAddInvoice: "",
    receiveBitcoinScreenAlert: false,

    bestBlockHeight: types.maybe(types.number),
    startBlockHeight: types.maybe(types.number),
    percentSynced: 0,

    pendingChannels: types.array(PendingChannelModel),
    channels: types.array(ChannelModel),

    onchain_transactions: types.array(OnChainTransactionModel),
    invoices: types.array(InvoiceModel),
    payments: types.array(PaymentModel),
  })
  .actions(self => {
    return {
      setLndReady: flow(function*() {
        self.lndReady = true

        yield self.updatePendingChannels()
        yield self.listChannels()

        yield self.getInfo()
        yield self.update()
      }),

      // stateless, but must be an action instead of a view because of the async call
      initState: flow(function*() {
        const WALLET_EXIST = "rpc error: code = Unknown desc = wallet already exists"
        const GRPC_INSECURE =
          "grpc: no transport security set (use grpc.WithInsecure() explicitly or set credentials)"
        const CLOSED = "closed"
        let walletExist = false

        for (const _ of [0, 1, 2, 3, 4, 5]) {
          try {
            yield getEnv(self).lnd.grpc.sendUnlockerCommand("GenSeed")
          } catch (err) {
            console.tron.log("initState, err:", err)
            if (err.message === WALLET_EXIST) {
              walletExist = true
            } else if (err.message === GRPC_INSECURE) {
              // not sure why we fall in this case but retry seems to work
              yield sleep(250)
              continue
            } else if (err.message === CLOSED) {
              // We assumed that if sendUnlockerCommand is locked, the node is already launched.
              // this is useful for hot reloading
              walletExist = true
              self.setLndReady()
            } else {
              console.tron.error(`unhandled error message ${err.message}`)
            }
          }

          self.walletExist = walletExist
          break
        }
      }),

      genSeed: flow(function*() {
        if (self.walletExist) {
          // TODO be able to recreate the wallet
          console.tron.warning(`genSeed: can't create a new wallet when one already exist`)
          return
        }

        try {
          const seed = yield getEnv(self).lnd.grpc.sendUnlockerCommand("GenSeed")
          console.tron.log("seed", seed.cipherSeedMnemonic)
          yield new KeychainAction().setItem("seed", seed.cipherSeedMnemonic.join(" "))
        } catch (err) {
          console.tron.error(err)
        }
      }),

      initWallet: flow(function*() {
        if (self.walletExist) {
          // TODO be able to recreate the wallet
          console.tron.warning(`initWallet: can't create a new wallet when one already exist`)
          return
        }

        const random_number = yield generateSecureRandom(24)
        const wallet_password = toHex(random_number)

        try {
          yield getEnv(self).lnd.grpc.sendUnlockerCommand("InitWallet", {
            walletPassword: Buffer.from(wallet_password, "hex"),
            cipherSeedMnemonic: (yield new KeychainAction().getItem("seed")).split(" "),
          })

          yield new KeychainAction().setItem("password", wallet_password)

          self.walletExist = true
        } catch (err) {
          console.tron.error(err)
        }
      }),

      // TODO: triggered this automatically after the wallet is being unlocked
      sendPubkey: flow(function*() {
        try {
          const result = yield functions().httpsCallable("sendPubkey")({
            pubkey: self.pubkey,
            network: self.network,
          })
          console.tron.log("sendpubkey", result)
        } catch (err) {
          console.tron.error(`can't send pubkey`, err)
          throw err
        }
      }),

      connectGaloyPeer: flow(function*() {
        if (!self.syncedToChain) {
          console.tron.warn("needs to be synced to chain before connecting to a peer")
          return
        }

        let doc
        try {
          doc = yield firestore()
            .doc(`global/info`)
            .get()
        } catch (err) {
          console.tron.error(`can't get Galoy node info`, err)
          return
        }

        let { pubkey, host } = doc.data().lightning
        // if (isSimulator()) { host = "127.0.0.1" }
        console.tron.log(`connecting to:`, { pubkey, host })

        // TODO: managed the already connected case?
        try {
          const connection = yield getEnv(self).lnd.grpc.sendCommand("connectPeer", {
            addr: { pubkey, host },
          })

          console.log(connection)
        } catch (err) {
          console.tron.warn(`can't connect to peer`, err.toString())
          throw err
        }
      }),

      listPeers: flow(function*() {
        try {
          const result = yield getEnv(self).lnd.grpc.sendCommand("listPeers")
          console.tron.log("listPeers:", result)
        } catch (err) {
          console.tron.error(err)
        }
      }),

      updatePendingChannels: flow(function*() {
        try {
          const result = yield getEnv(self).lnd.grpc.sendCommand("pendingChannels")
          console.tron.log("pendingChannels raw:", result)
          const pendingChannels = result.pendingOpenChannels?.map(input => ({ ...input.channel }))
          console.tron.log("pendingChannels parsed:", pendingChannels)
          self.pendingChannels = pendingChannels
        } catch (err) {
          console.tron.error(err)
          throw err
        }
      }),

      listChannels: flow(function*() {
        try {
          const result = yield getEnv(self).lnd.grpc.sendCommand("listChannels")
          const channels = result.channels.map(input => ({ ...input }))
          console.tron.log("listChannels:", channels)
          self.channels = channels
        } catch (err) {
          console.tron.error("list channels issue")
          console.tron.error(err)
          throw err
        }
      }),

      getInfo: flow(function*() {
        /**
         * An internal helper function to approximate the current progress while
         * syncing Neutrino to the full node.
         * @param  {Object} grpcInput The getInfo's grpc api response
         * @return {number}          The percrentage a number between 0 and 1
         */
        const calcPercentSynced = grpcInput => {
          let response

          if (self.bestBlockHeight === undefined || self.startBlockHeight == undefined) {
            response = 0
          } else if (self.bestBlockHeight! <= self.startBlockHeight!) {
            response = 1
          } else {
            const percentSync =
              (grpcInput.blockHeight - self.startBlockHeight!) /
              (self.bestBlockHeight! - self.startBlockHeight!)
            response = +percentSync.toFixed(3)
          }

          if (response > 1) {
            response = 1
          }
          if (response < 0) {
            response = 0
          }
          if (isNaN(response)) {
            console.tron.log(`reponse is NaN, 
            self.bestBlockHeight ${self.bestBlockHeight}
            self.startBlockHeight ${self.startBlockHeight}
            grpcInput.blockHeight ${grpcInput.blockHeight}          
            `)
            response = 0
          }

          return response
        }

        let response

        try {
          response = yield getEnv(self).lnd.grpc.sendCommand("getInfo")
        } catch (err) {
          console.tron.error(`Getting node info failed, ${err}`)
          throw err
        }
        self.version = response.version.split(" ")[0]
        self.pubkey = response.identityPubkey
        self.syncedToChain = response.syncedToChain
        self.blockHeight = response.blockHeight
        self.network = response.chains[0].network

        if (self.startBlockHeight === undefined) {
          self.startBlockHeight = response.blockHeight

          let url

          // FIXME see when this is fixed: https://github.com/lightningnetwork/lnd/issues/3270
          if (Config.BITCOIN_NETWORK === "testnet") {
            url = "http://api.blockcypher.com/v1/btc/test3"
          } else if (Config.BITCOIN_NETWORK === "mainnet") {
            url = "https://api.blockcypher.com/v1/btc/main"
          } else {
            throw new Error("config issue")
          }

          try {
            const response = yield fetch(url) // FIXME find a better solution
            const json = yield response.json()
            const { height } = json
            console.tron.log(json)
            console.tron.log(`blockcypher height... ${height}`)
            self.bestBlockHeight = height
          } catch (err) {
            console.warn(`can't fetch blockcypher`, err)
          }
        }

        if (response.syncedToChain) {
          console.tron.log("Syncing complete")

          // TODO verify if undefined, show not be === to false?
          if (auth().currentUser?.isAnonymous === false) {
            try {
              yield self.updatePendingChannels()
              yield self.listChannels()

              if (self.statusFirstChannel === FirstChannelStatus.noChannel) {
                console.tron.warn(
                  "opening a channel, uncommon scenario (not in sync while doing phone verification)",
                )
                yield self.openFirstChannel()
              } else {
                yield functions().httpsCallable("requestRewards")({}) // TODO: move on channel active instead on the server side?
              }
            } catch (err) {
              console.tron.error(err.toString())
            }
          }
        }

        self.percentSynced = calcPercentSynced(response)
        return response.syncedToChain
      }),

      openFirstChannel: flow(function*() {
        console.tron.log("openFirstChannel")

        try {
          yield self.sendPubkey()
          yield self.connectGaloyPeer()

          const result = yield functions().httpsCallable("openFirstChannel")({})
          console.tron.log("opening a channel with Galoy node", result)

          yield self.updatePendingChannels()
          return true
        } catch (err) {
          console.tron.error("open First Channel issue: ", err.toString())
          return err
        }
      }),

      update: flow(function*() {
        yield self.updateBalance()
        yield self.updateTransactions()
        yield self.updateInvoices()
        yield self.listPayments()
      }),

      unlockWallet: flow(function*() {
        // TODO: auth with biometrics/passcode
        const wallet_password = yield new KeychainAction().getItem("password")

        try {
          yield getEnv(self).lnd.grpc.sendUnlockerCommand("UnlockWallet", {
            walletPassword: Buffer.from(wallet_password, "hex"),
          })

          yield self.walletGotOpened()
        } catch (err) {
          console.tron.error(err)
        }
      }),

      newAddress: flow(function*() {
        const { address } = yield getEnv(self).lnd.grpc.sendCommand("NewAddress", { type: 0 })
        self.onChainAddress = address
        console.tron.log(address)
      }),

      decodePayReq: flow(function*(payReq) {
        return yield getEnv(self).lnd.grpc.sendCommand("decodePayReq", {
          payReq,
        })
      }),

      addInvoice: flow(function*({ value, memo, expiry = 172800 /* 48h */ }) {
        const response = yield getEnv(self).lnd.grpc.sendCommand("addInvoice", {
          value,
          memo,
          expiry,
          private: true,
        })

        self.lastAddInvoice = response.paymentRequest

        return response
      }),

      clearLastInvoice: flow(function*() {
        self.lastAddInvoice = ""
      }),

      resetReceiveBitcoinScreenAlert: flow(function*() {
        self.receiveBitcoinScreenAlert = false
      }),

      updateBalance: flow(function*() {
        try {
          const onChainBalance = yield getEnv(self).lnd.grpc.sendCommand("WalletBalance")
          const channelBalance = yield getEnv(self).lnd.grpc.sendCommand("ChannelBalance")
          self.confirmedBalance = onChainBalance.confirmedBalance + channelBalance.balance
          self.unconfirmedBalance =
            onChainBalance.unconfirmedBalance + channelBalance.pendingOpenBalance

          return self.balance
        } catch (err) {
          console.tron.error(`Getting wallet balance failed ${err}`)
          throw err
        }
      }),

      updateTransactions: flow(function*() {
        try {
          const { transactions } = yield getEnv(self).lnd.grpc.sendCommand("getTransactions")

          const transaction_good_types = transactions.map(input => ({ ...input }))

          console.tron.log("onchain_transactions", transactions, transaction_good_types)

          self.onchain_transactions = transaction_good_types
        } catch (err) {
          console.tron.error(`Listing transactions failed ${err}`)
          throw err
        }
      }),

      updateInvoice: flow(function*(invoice) {
        if (invoice === undefined) return
        if (!invoice.settled) return

        let localIOSNotif

        if (invoice.paymentRequest === self.lastAddInvoice) {
          if (
            currentScreen(getParentOfType(self, RootStoreModel).navigationStore.state) ===
            "receiveBitcoin"
          ) {
            self.receiveBitcoinScreenAlert = true
            localIOSNotif = false
          } else {
            localIOSNotif = true
          }

          self.lastAddInvoice = ""
        } else {
          localIOSNotif = true
        }

        if (localIOSNotif) {
          Notifications.postLocalNotification({
            body: translate("notifications.payment.body", {value: invoice.value}),
            title: translate("notifications.payment.title"),
            category: "SOME_CATEGORY",
            link: "localNotificationLink",
          })
        }
      }),

      updateInvoices: flow(function*() {
        try {
          const { invoices } = yield getEnv(self).lnd.grpc.sendCommand("listInvoices")

          function formatingRecords<T>(source: T) {
            const result = {}
            Object.keys(source).forEach(key => {
              if (key == "123123") {
                // FIXME 123123 as a env variable
                const value = source[key]
                result[key] = Buffer.from(Object.values(value), "hex").toString()
                // todo manage conversion properly depending of type
              }
            }, {})
            // XXX FIXME
            return result["123123"] ? result["123123"] : undefined
            return result as T
          }

          const invoices_good_types = invoices.map(input => ({
            ...input,
            //   receipt: toHex(tx.receipt), // do we want this? receipt are empty
            rPreimage: toHex(input.rPreimage),
            rHash: toHex(input.rHash),
            htlcs: input.htlcs.map(htlc => ({
              ...htlc,
              customRecords: formatingRecords(htlc.customRecords),
            })),
          }))

          console.tron.log("invoices", invoices, invoices_good_types)

          // const htlc = invoices_good_types[0].htlcs[0]
          // const result = HTLCModel.create({...htlc})
          // console.tron.log(result)

          self.invoices = invoices_good_types
        } catch (err) {
          console.tron.error(`Listing invoices failed ${err}`)
          // throw err
        }
      }),

      listPayments: flow(function*() {
        try {
          const { payments } = yield getEnv(self).lnd.grpc.sendCommand("listPayments")!

          var lightningPayReq = require("bolt11")

          // FIXME bolt11 package duplicate with decodePayReq function
          const payments_good_types = payments.map(input => ({
            ...input,
            description: lightningPayReq
              .decode(input.paymentRequest)
              .tags.filter(item => item.tagName == "description")[0]?.data,
          }))

          console.tron.log("payments", payments, payments_good_types)

          self.payments = payments_good_types
        } catch (err) {
          console.tron.error(`Listing payments failed ${err}`)
          // throw err
        }
      }),

      sendTransaction: flow(function*(addr, amount) {
        return yield getEnv(self).lnd.grpc.sendCommand("sendCoins", { addr, amount })
      }),

      // doesn't update the store, should this be here?
      payInvoice: flow(function*(paymentRequest) {
        const PAYMENT_TIMEOUT = 10000 // how long is this?

        let success = true
        const timeout = setTimeout(() => {
          success = false
          // TODO: do something to show payment failed
        }, PAYMENT_TIMEOUT)

        try {
          const stream = getEnv(self).lnd.grpc.sendStreamCommand("sendPayment")

          yield new Promise((resolve, reject) => {
            stream.on("data", data => {
              if (data.paymentError) {
                reject(new Error(`Lightning payment error: ${data.paymentError}`))
              } else {
                resolve()
              }
            })
            stream.on("error", reject)
            stream.write(JSON.stringify(paymentRequest), "utf8")
          })

          return success
        } catch (err) {
          console.tron.error(err)
          throw err

          // this._nav.goPayLightningConfirm();
          // this._notification.display({ msg: 'Lightning payment failed!', err });
        } finally {
          clearTimeout(timeout)
        }
      }),
    }
  })
  .views(self => ({
    get currency() {
      return CurrencyType.BTC
    },

    get fundingTx() {
      return self.pendingChannels[0]?.channelPoint.split(":")[0]
    },

    get statusFirstChannel() {
      if (self.channels.length > 0) {
        return FirstChannelStatus.opened
      }

      if (self.pendingChannels.length > 0) {
        return FirstChannelStatus.pending
      }

      return FirstChannelStatus.noChannel
    },

    get transactions() {
      // TODO, optimize with some form of caching

      const onchainTxs = self.onchain_transactions.map(transaction => ({
        id: transaction.txHash,
        name: transaction.amount > 0 ? "Received" : "Sent",
        icon: transaction.amount > 0 ? "ios-download" : "ios-exit",
        amount: transaction.amount,
        date: parseDate(transaction.timeStamp),
        status: transaction.numConfirmations < 3 ? "unconfirmed" : "confirmed",
      }))

      const formatInvoice = invoice => {
        if (invoice.settled) {
          if (invoice.memo) {
            return invoice.memo
          } else if (invoice.htlcs[0].customRecords) {
            return translateTitleFromItem(invoice.htlcs[0].customRecords)
          } else {
            return `Payment received`
          }
        } else {
          return `Waiting for payment`
        }
      }

      const formatPayment = payment => {
        if (payment.description) {
          try {
            const decode = JSON.parse(payment.description)
            return decode.memo
          } catch (e) {
            return payment.description
          }
        } else {
          return `Paid invoice ${shortenHash(payment.paymentHash, 2)}`
        }
      }

      const filterExpiredInvoice = invoice => {
        if (invoice.settled === true) {
          return true
        }
        if (new Date().getTime() / 1000 > invoice.creationDate + invoice.expiry) {
          return false
        }
        return true
      }

      const invoicesTxs = self.invoices.filter(filterExpiredInvoice).map(invoice => ({
        id: invoice.rHash,
        icon: "ios-thunderstorm",
        name: formatInvoice(invoice),
        amount: invoice.value,
        status: invoice.settled ? "complete" : "in-progress",
        date: parseDate(invoice.creationDate),
        preimage: invoice.rPreimage,
        memo: invoice.memo,
      }))

      const paymentTxs = self.payments.map(payment => ({
        id: payment.paymentHash,
        icon: "ios-thunderstorm",
        name: formatPayment(payment),
        // amount should be negative so that it's shown as "spent"
        amount: -payment.valueSat,
        date: parseDate(payment.creationDate),
        preimage: payment.paymentPreimage,
        status: "complete", //filter for succeed on ?
      }))

      const all_txs = [...onchainTxs, ...invoicesTxs, ...paymentTxs].sort((a, b) =>
        a.date > b.date ? 1 : -1,
      )
      return all_txs
    },
  }))

export const AccountModel = types.union(FiatAccountModel, LndModel)

export const RatesModel = types
  .model("Rates", {
    USD: 1, // TODO is there a way to have enum as parameter?
    BTC: 0.0001, // Satoshi to USD default value
  })
  .actions(self => {
    const update = flow(function*() {
      try {
        const doc = yield firestore()
          .doc("global/price")
          .get()
        self.BTC = doc.data().BTC
      } catch (err) {
        console.tron.error("error getting BTC price from firestore", err)
      }
    })
    return { update }
  })
  .views(self => ({
    // workaround on the fact key can't be enum
    rate(currency: CurrencyType) {
      if (currency === CurrencyType.USD) {
        return self.USD
      } else if (currency === CurrencyType.BTC) {
        return self.BTC
      }
    },
  }))

interface BalanceRequest {
  currency: CurrencyType
  account: AccountType
}


// TODO move to utils?
const translateTitleFromItem = (item) => {
  console.tron.log({item})
  const object = translate(`RewardsScreen.rewards`)
  for (const property in object) {
    for (const property2 in object[property]) {
      if (property2 === item) {
        return object[property][property2].title
      }
    }
  }
  return "Translation not found"
}

export const OnboardingModel = types
  .model("Onboarding", {
    type: AccountType.VirtualBitcoin,
    currency: CurrencyType.BTC,
    stage: types.array(types.enumeration<Onboarding>("Onboarding", Object.values(Onboarding))),
  })
  .actions(self => ({
    add: flow(function*(step) {
      if (self.stage.findIndex(item => item == step) === -1) {
        self.stage.push(step)
      }
    }),

    // dummy function to have same interface with bitcoin wallet and bank account
    update: flow(function*() {}),

    // for debug when resetting account
    _reset: flow(function*() {
      while (self.stage.length > 0) {
        self.stage.pop()
      }
    }),
  }))
  .views(self => ({
    // TODO using: BalanceRequest type, how to set it?
    has(step: Onboarding) {
      // TODO exception
      // --> notifications
      // --> phoneAuth

      return self.stage.findIndex(item => item == step) !== -1
    },

    get balance() {
      const rewards = self.stage.map(item => OnboardingRewards[item])
      if (rewards.length > 0) {
        return rewards.reduce((acc, curr) => acc + curr)
      } else {
        return 0
      }
    },

    get rewardsAvailable() {
      return difference(Object.values(Onboarding), self.stage).length
    },

    get transactions() {
      const txs = self.stage.map(item => ({
        // TODO: interface for those pending transactions
        name: translateTitleFromItem(item),
        icon: "ios-exit",
        amount: OnboardingRewards[item],
        date: Date.now(),
      }))

      console.tron.log({txs})
      return txs
    },
  }))

export const DataStoreModel = types
  .model("DataStore", {
    onboarding: types.optional(OnboardingModel, {}),
    fiat: types.optional(FiatAccountModel, {}),
    rates: types.optional(RatesModel, {}),
    exchange: types.optional(ExchangeModel, {}),
    lnd: types.optional(LndModel, {}), // TODO should it be optional?
  })
  .actions(self => ({
    updateBalance: flow(function*() {
      yield Promise.all([
        yield self.rates.update(),
        yield self.fiat.updateBalance(),
        yield self.lnd.updateBalance(),
      ])
    }),
  }))
  .views(self => ({
    // TODO using: BalanceRequest type, how to set it?
    balances({ currency, account }) {
      const balances = {}

      const btcConversion = self.rates.rate(self.lnd.currency) / self.rates.rate(currency)

      balances[AccountType.Bitcoin] = self.lnd.balance * btcConversion
      balances[AccountType.VirtualBitcoin] = self.onboarding.balance * btcConversion
      balances[AccountType.Bank] = self.fiat.balance / self.rates.rate(currency)
      balances[AccountType.AllReal] = balances[AccountType.Bank] + balances[AccountType.Bitcoin]
      balances[AccountType.AllVirtual] =
        balances[AccountType.Bank] + balances[AccountType.VirtualBitcoin]

      return balances[account]
    },
  }))

/**
  * Un-comment the following to omit model attributes from your snapshots (and from async storage).
  * Useful for sensitive data like passwords, or transitive state like whether a modal is open.

  * Note that you'll need to import `omit` from ramda, which is already included in the project!
  *  .postProcessSnapshot(omit(["password", "socialSecurityNumber", "creditCardNumber"]))
  */

type DataStoreType = Instance<typeof DataStoreModel>
export interface DataStore extends DataStoreType {}

type DataStoreSnapshotType = SnapshotOut<typeof DataStoreModel>
export interface DataStoreSnapshot extends DataStoreSnapshotType {}

export type LndStore = Instance<typeof LndModel>

type FiatAccountType = Instance<typeof FiatAccountModel>
export interface FiatAccount extends FiatAccountType {}

// type CryptoAccountType = Instance<typeof LndModel> // FIXME is that still accurate?
// export interface CryptoAccount extends CryptoAccountType {}

type RatesType = Instance<typeof RatesModel>
export interface Rates extends RatesType {}
