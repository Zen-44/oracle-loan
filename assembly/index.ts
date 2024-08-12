import {
    Address,
    Bytes,
    Context,
    Host, 
    Balance,
    PersistentMap,
    Vector,
    util,
    u128
} from "idena-sdk-as";

class OracleData{
    isApproved: bool;
    feePaid: bool;
    isFunded: bool;
    ownerDeposit: Balance;

    isDefaultValue: bool;

    constructor(isDefaultValue: bool = false){
        this.isApproved = false;
        this.feePaid = false;
        this.isFunded = false;
        this.ownerDeposit = Balance.Zero;
        this.isDefaultValue = isDefaultValue;
    }

    exists(): bool{
        return !this.isDefaultValue;
    }
}

const maxStartTimeOffset: u64 = 60 * 60 * 24 * 7 * 2;       // 2 weeks (seconds)
const maxOracleDuration: u64 = 60 * 24 * 7 * 4 * 3;         // 4 weeks (number of blocks)

export class OracleLoan{
    deposits: PersistentMap<Address, Balance>;
    depositors: Vector<Address>;
    depositsPool: Balance = Balance.Zero;                   // sum of all deposits

    oracles: PersistentMap<Address, OracleData>;

    committeePresident: Address;
    reviewCommittee: PersistentMap<Address, i8>;

    feeRate: u8 = 5;                                        // 5% of oracle deposit
    paused: bool = false;
    baseGasLimit: u32 = 3_000_000;


    constructor(){
        this.deposits = PersistentMap.withStringPrefix<Address, Balance>("deposits");
        this.depositors = new Vector<Address>("depositors");
        this.oracles = PersistentMap.withStringPrefix<Address, OracleData>("oracles");
        this.reviewCommittee = PersistentMap.withStringPrefix<Address, i8>("reviewCommittee");

        this.committeePresident = Context.caller();
        this.reviewCommittee.set(this.committeePresident, 1);
    }

    @view 
    getBalance(addr: Address): Balance{
        return this.deposits.get(addr, Balance.Zero);
    }

    @view 
    getCommitteePresident(): Address{
        return this.committeePresident;
    }

    @view
    getFeeRate(): u8{
        return this.feeRate;
    }

    @view 
    isPaused(): bool{
        return this.paused;
    }

    @view 
    isApprovedOracle(addr: Address): bool{
        let data: OracleData = this.oracles.get(addr, new OracleData(true));
        return data.isApproved;
    }

    @view 
    isFeePaid(addr: Address): bool{
        let data: OracleData = this.oracles.get(addr, new OracleData(true));
        return data.feePaid;
    }

    @view 
    isCommitteeMember(addr: Address): bool{
        return this.reviewCommittee.get(addr, 0) != 0;
    }

    @view 
    isDepositor(addr: Address): bool{
        return this.deposits.get(addr, Balance.from(u128.Max)) != Balance.from(u128.Max);
    }

    @mutateState
    deposit(to: Address = Context.caller()): void{
        let amount: Balance = Context.payAmount();
        let existingBalance: Balance = this.getBalance(to);
        if (!this.isDepositor(to))
            this.depositors.pushBack(to);

        this.depositsPool += amount;
        this.deposits.set(to, existingBalance + amount);
        Host.emitEvent("deposit", [to.toBytes(), Bytes.fromBytes(amount.toBytes())]);
    }

    @mutateState
    withdraw(amount: Balance, to: Address = Context.caller()): void{
        let existingBalance: Balance = this.getBalance(Context.caller());
        util.assert(existingBalance >= amount, "Not enough balance");

        let contractBalance: Balance = Context.contractBalance();
        util.assert(contractBalance >= amount, "Not enough contract balance");

        this.deposits.set(to, existingBalance - amount);
        this.depositsPool -= amount;

        Host.createTransferPromise(to, amount);
        Host.emitEvent("withdraw", [to.toBytes(), Bytes.fromBytes(amount.toBytes())]);
    }

    withdrawUntrackedBalance(): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can withdraw untracked balance");
        util.assert(Context.contractBalance() > this.depositsPool, "No untracked balance to withdraw");
        let amount: Balance = Context.contractBalance() - this.depositsPool;
        Host.createTransferPromise(Context.caller(), amount);
        Host.emitEvent("untrackedBalanceWithdrawn", [Bytes.fromBytes(amount.toBytes())]);
    }

    @mutateState
    changeCommitteePresident(addr: Address): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can change committee president");
        this.reviewCommittee.delete(this.committeePresident);
        this.committeePresident = addr;
        this.reviewCommittee.set(addr, 1);
        Host.emitEvent("committeePresidentChanged", [addr.toBytes()]);
    }

    addCommitteeMember(addr: Address): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can add members");
        this.reviewCommittee.set(addr, 1);
        Host.emitEvent("committeeMemberAdded", [addr.toBytes()]);
    }

    removeCommitteeMember(addr: Address): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can remove members");
        this.reviewCommittee.delete(addr);
        Host.emitEvent("committeeMemberRemoved", [addr.toBytes()]);
    }

    @mutateState
    pause(): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can pause the contract");
        this.paused = true;
        Host.emitEvent("contractPaused", []);
    }

    @mutateState
    unpause(): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can unpause the contract");
        this.paused = false;
        Host.emitEvent("contractUnpaused", []);
    }

    @mutateState
    changeFeeRate(rate: u8): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can change fee rate");
        util.assert(1 <= rate && rate <= 100, "Invalid fee rate");
        this.feeRate = rate;
        Host.emitEvent("feeRateChanged", [Bytes.fromU8(rate)]);
    }

    @mutateState
    changeBaseGasLimit(limit: u32): void{
        util.assert(Context.caller() == this.committeePresident, "Only committee president can change base gas limit");
        this.baseGasLimit = limit;
        Host.emitEvent("baseGasLimitChanged", [Bytes.fromU32(limit)]);
    }

    approveOracle(addr: Address): void{
        util.assert(this.reviewCommittee.get(Context.caller(), 0) != 0, "Only committee members can approve oracles");
        util.assert(this.oracles.get(addr, new OracleData(true)).exists(), "Oracle not found");

        let data: OracleData = this.oracles.get(addr, new OracleData());
        data.isApproved = true;
        this.oracles.set(addr, data);
        Host.emitEvent("oracleApproved", [addr.toBytes()]);
    }

    @mutateState
    payOracleFee(addr: Address): void{
        let amount: Balance = Context.payAmount();
        let oracleData: OracleData = this.oracles.get(addr, new OracleData(true));
        let ownerDeposit: Balance = oracleData.ownerDeposit;

        util.assert(oracleData.exists(), "Oracle not found");
        util.assert(amount >= ownerDeposit * Balance.from(this.feeRate) / Balance.from(100), "Invalid fee amount");
        util.assert(oracleData.isApproved, "Oracle not approved");
        util.assert(Context.contractBalance() >= oracleData.ownerDeposit, "Not enough contract balance");
        util.assert(oracleData.feePaid == false, "Fee already paid");
        util.assert(oracleData.isFunded == false, "Oracle already funded");     // redundant

        oracleData.feePaid = true;
        oracleData.isFunded = true;

        // distribute the fee
        for (let i = 0; i < this.depositors.length; i++){
            let deposit: Balance = this.getBalance(this.depositors[i]);
            if (deposit == Balance.Zero)
                continue;

            let u128Amount: u128 = u128.fromBytes(Bytes.fromBytes(amount.toBytes()), true);
            let u128Deposit: u128 = u128.fromBytes(Bytes.fromBytes(deposit.toBytes()), true);
            let u128depositsPool: u128 = u128.fromBytes(Bytes.fromBytes(this.depositsPool.toBytes()), true);
            let share: u128 = u128.muldiv(u128Amount, u128Deposit, u128depositsPool);

            let balanceShare: Balance = Balance.fromBytes(Bytes.fromu128(u128.fromUint8ArrayBE(Bytes.fromu128(share))));

            this.deposits.set(this.depositors[i], deposit + balanceShare);
            Host.emitEvent("feePaid", [this.depositors[i].toBytes(), Bytes.fromBytes(balanceShare.toBytes())]);
        }
        this.depositsPool += amount;

        // fund the oracle
        this.oracles.set(addr, oracleData);

        Host.createTransferPromise(addr, oracleData.ownerDeposit);
        Host.emitEvent("oracleFunded", [addr.toBytes(), Bytes.fromBytes(oracleData.ownerDeposit.toBytes())]);
    }
    
    proposeOracle(addr: Address): void{
        let data: OracleData = this.oracles.get(addr, new OracleData(true));
        util.assert(data.exists() == false, "Oracle already exists");
        
        // this will create a chain of functions calls
        Host.createReadContractDataPromise(addr, Bytes.fromString("refundRecipient"), 20_000).then("_verifyOracleRefundAddr", [addr], Balance.Zero, 6 * this.baseGasLimit);
        Host.emitEvent("proposeOracle", [addr.toBytes()]);
    }

    _verifyOracleRefundAddr(addr: Address): void{
        let refundRecipient = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle refund address");

        util.assert(Address.fromBytes(refundRecipient) == Context.contractAddress(), "Invalid oracle refund address");

        Host.createReadContractDataPromise(addr, Bytes.fromString("ownerFee"), 20_000).then("_verifyOwnerFee", [addr], Balance.Zero, 5 * this.baseGasLimit);
    }
 
    _verifyOwnerFee(addr: Address): void{
        let ownerFee = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle owner fee");

        util.assert(ownerFee.toI8() == 0, "Invalid oracle owner fee");

        Host.createReadContractDataPromise(addr, Bytes.fromString("startTime"), 20_000).then("_verifyStartTimestamp", [addr], Balance.Zero, 4 * this.baseGasLimit);
    }

    _verifyStartTimestamp(addr: Address): void{
        let startTime = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle start time");

        util.assert(Context.blockTimestamp() + maxStartTimeOffset >= startTime.toI64(), "Invalid oracle start time"); // needs to be commented for tests

        Host.createReadContractDataPromise(addr, Bytes.fromString("votingDuration"), 20_000).then("_verifyVotingDuration", [addr], Balance.Zero, 3 * this.baseGasLimit);
    }

    _verifyVotingDuration(addr: Address): void{
        // the value read here (votingDuration) will be passed to the next function to calculate the total duration
        let votingDuration = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle voting duration");

        Host.createReadContractDataPromise(addr, Bytes.fromString("publicVotingDuration"), 20_000).then("_verifyPublicVotingDuration", [addr, votingDuration], Balance.Zero, 2 * this.baseGasLimit);
    }

    _verifyPublicVotingDuration(addr: Address, votingDuration: Bytes): void{
        let publicVotingDuration = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle public voting duration");
        
        let totalDuration = votingDuration.toU64() + publicVotingDuration.toU64();
        util.assert(totalDuration <= maxOracleDuration, "Invalid oracle duration");

        Host.createReadContractDataPromise(addr, Bytes.fromString("ownerDeposit"), 20_000).then("_registerOracle", [addr], Balance.Zero, this.baseGasLimit);
    }

    _registerOracle(addr: Address): void{
        let ownerDeposit = Host.promiseResult().value();
        util.assert(Host.promiseResult().failed() == false, "Failed to read oracle owner deposit");

        let data: OracleData = new OracleData();
        data.ownerDeposit = Balance.fromBytes(ownerDeposit);
        this.oracles.set(addr, data);
    }
}