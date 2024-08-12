const path = require("path")
const fs = require("fs")

const {
  ContractRunnerProvider,
  ContractArgumentFormat,
} = require("idena-sdk-tests")

const contractRunnerAddress = "[PLACEHOLDER]";     // needs to be updated if the contract runner is restarted

async function deployContract(resetChain = true) {
  const wasm = path.join(".", "build", "release", "oracle-loan.wasm")
  const provider = ContractRunnerProvider.create("http://localhost:3333", "")
  const code = fs.readFileSync(wasm)

  if (resetChain) {
    await provider.Chain.generateBlocks(1)
    await provider.Chain.resetTo(2)
  }

  const deployTx = await provider.Contract.deploy("0", "9999", code, Buffer.from(""))
  await provider.Chain.generateBlocks(1)

  const deployReceipt = await provider.Chain.receipt(deployTx)
  expect(deployReceipt.success).toBe(true)
  return { provider: provider, contract: deployReceipt.contract }
}

function boolToHexString(bool){
    return bool ? "0x74727565" : "0x66616c7365";
}

async function rpcCall(data){
    let response = await fetch("http://localhost:3333", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });
    let responseJson = await response.json();
    return responseJson;
}

async function deployOracle(startTime, duration, publicDuration, ownerFee, refundRecipient){
    // mock oracle contract
    let deployTx = {
        "method": "contract_deploy",
        "params": [
          {
            "codeHash": "0x02",
            "amount": 50000,
            "maxFee": 100,
            "args": [
              {
                "index": 0,
                "format": "hex",
                "value": "0x7b227469746c65223a20225175657374696f6e222c202264657363223a20224465736372697074696f6e222c20226f7074696f6e73223a205b7b2276616c7565223a226669727374227d2c207b2276616c7565223a20227365636f6e64227d5d7d"
              },
              {
                "index": 1,
                "format": "uint64",
                "value": startTime.toString()
              },
              {
                "index": 2,
                "format": "uint64",
                "value": duration.toString()
              },
              {
                "index": 3,
                "format": "uint64",
                "value": publicDuration.toString()
              },
              {
                "index": 4,
                "format": "byte",
                "value": "0"
              },
              {
                "index": 5,
                "format": "byte",
                "value": "0"
              },
              {
                "index": 6,
                "format": "uint64",
                "value": "0"
              },
              {
                "index": 7,
                "format": "dna",
                "value": "0"
              },
              {
                "index": 8,
                "format": "byte",
                "value": ownerFee.toString()
              },
              {
                "index": 10,
                "format": "hex",
                "value": refundRecipient
              }
            ]
          }
        ],
        "id": 1,
        "key": ""
      };

    return await rpcCall(deployTx);
}

async function isOracleProposed(contract, oracleAddress){
    let data = {
        "method": "contract_readMap",
        "params": [
          contract,
          "oracles",
          oracleAddress,
          "hex"
        ],
        "id": 1,
        "key": ""
    };
    return await rpcCall(data);
}

function hexToBal(hex) {
    return parseInt(hex, 16) / 1e18
}

it("compiles", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    let call = await provider.Contract.call(
        contract,
        "getCommitteePresident",
        "0",
        "9999",
        []
      );

    await provider.Chain.generateBlocks(1);
    let callReceipt = await provider.Chain.receipt(call)
    expect(callReceipt.actionResult.outputData).toBe(contractRunnerAddress.toLowerCase());
});

it("can deposit and withdraw", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deposit
    let call = await provider.Contract.call(
        contract,
        "deposit",
        "100",
        "9999",
        []
    );

    await provider.Chain.generateBlocks(1);
    let transferReceipt = await provider.Chain.receipt(call)
    expect(transferReceipt.success).toBe(true)
    // console.log(transferReceipt)
    
    // check balance
    let checkBalance = async () => {
        let viewBalanceCall = await provider.Contract.call(
            contract,
            "getBalance",
            "0",
            "9999",
            [
                {
                    index: 0,
                    format: ContractArgumentFormat.Hex,
                    value: contractRunnerAddress
                }
            ]
        );
        
        await provider.Chain.generateBlocks(1);
        let balanceReceipt = await provider.Chain.receipt(viewBalanceCall)
        expect(balanceReceipt.success).toBe(true)
        return hexToBal(balanceReceipt.actionResult.outputData)
    }
    let bal = await checkBalance();
    expect(bal).toBe(100);
    
    // withdraw
    let withdrawCall = await provider.Contract.call(
        contract,
        "withdraw",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Dna,
                value: "50.5"
            }
        ]
    );

    await provider.Chain.generateBlocks(1);
    let withdrawReceipt = await provider.Chain.receipt(withdrawCall)
    expect(withdrawReceipt.success).toBe(true)
    // console.log(withdrawReceipt.events)

    // check balance again
    bal = await checkBalance();
    expect(bal).toBe(49.5);

    // withdraw too much
    let withdrawTooMuchCall = await provider.Contract.call(
        contract,
        "withdraw",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Dna,
                value: "49.6"
            }
        ]
    );

    await provider.Chain.generateBlocks(1);
    let withdrawTooMuchReceipt = await provider.Chain.receipt(withdrawTooMuchCall)
    expect(withdrawTooMuchReceipt.success).toBe(false)
    // console.log(withdrawTooMuchReceipt)

    // check balance again
    bal = await checkBalance();
    expect(bal).toBe(49.5);
});

it("can withdraw untracked balance", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deposit
    await provider.Contract.call(
        contract,
        "deposit",
        "100",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);

    // try to withdraw untracked balance
    let withdrawCall = await provider.Contract.call(
        contract,
        "withdrawUntrackedBalance",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let withdrawReceipt = await provider.Chain.receipt(withdrawCall);
    expect(withdrawReceipt.success).toBe(false);

    // send idna without using deposit method
    let call = await provider.Contract.call(
        contract,
        "getFeeRate",
        "5",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let callReceipt = await provider.Chain.receipt(call);

    // try to withdraw untracked balance again
    let withdrawCall2 = await provider.Contract.call(
        contract,
        "withdrawUntrackedBalance",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let withdrawReceipt2 = await provider.Chain.receipt(withdrawCall2);
    expect(parseInt(withdrawReceipt2.events[0].args[0], 16)).toBe(5 * 1e18);
    expect(withdrawReceipt2.success).toBe(true);
});

it("accepts valid oracle", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let validOracle = await deployOracle(1723281497, 1000, 1000, 0, contract);
    await provider.Chain.generateBlocks(1);
    let validOracleAddress = (await provider.Chain.receipt(validOracle.result)).contract;

    // propose the oracle to the smart contract
    let call = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);
    fs.writeFileSync("output.json", JSON.stringify(receipt));
    
    // check results
    let hasResult = false;
    if ((await isOracleProposed(contract, validOracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(true);
    
    // fs.writeFileSync("output.json", JSON.stringify(receipt));
});

it("rejects double submission", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let validOracle = await deployOracle(1723281497, 1000, 1000, 0, contract);
    await provider.Chain.generateBlocks(1);
    let validOracleAddress = (await provider.Chain.receipt(validOracle.result)).contract;

    // propose the oracle to the smart contract
    let call = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);
    expect(receipt.success).toBe(true);
    
    // check results
    let hasResult = false;
    if ((await isOracleProposed(contract, validOracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(true);

    // attempt to redeploy the same oracle
    let call2 = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt2 = await provider.Chain.receipt(call2);
    expect(receipt2.success).toBe(false);
});

it("rejects invalid refund recipient", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let validOracle = await deployOracle(1723281497, 1000, 1000, 0, "0x0000000000000000000000000000000000000000");
    await provider.Chain.generateBlocks(1);
    let validOracleAddress = (await provider.Chain.receipt(validOracle.result)).contract;

    // propose the oracle to the smart contract
    let call = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);
    
    // check results
    let hasResult = false;
    if ((await isOracleProposed(contract, validOracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(false);
});

it("rejects invalid duration", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let validOracle = await deployOracle(1723281497, 120960, 1, 0, contract);
    await provider.Chain.generateBlocks(1);
    let validOracleAddress = (await provider.Chain.receipt(validOracle.result)).contract;

    // propose the oracle to the smart contract
    let call = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);
    
    // check results
    let hasResult = false;
    if ((await isOracleProposed(contract, validOracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(false);
});

it("rejects invalid owner fee", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let validOracle = await deployOracle(1723281497, 1000, 1000, 1, contract);
    await provider.Chain.generateBlocks(1);
    let validOracleAddress = (await provider.Chain.receipt(validOracle.result)).contract;

    // propose the oracle to the smart contract
    let call = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: validOracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);
    
    // check results
    let hasResult = false;
    if ((await isOracleProposed(contract, validOracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(false);
})

it("can manage committee members", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    let member = "0xcbb98843270812eeCE07BFb82d26b4881a33aA91"

    // add member to committee
    let call = await provider.Contract.call(
        contract,
        "addCommitteeMember",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: member
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(call);

    // check if member is in committee
    let data = {
        "method": "contract_estimateCall",
        "params": [
          {
            "contract": contract,
            "method": "isCommitteeMember",
            "args": [
                {
                    "index": 0,
                    "format": "hex",
                    "value": member
                }
            ]
          }
        ],
        "id": 1,
        "key": ""
    }
    let response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(true));

    // remove member from committee
    let removeCall = await provider.Contract.call(
        contract,
        "removeCommitteeMember",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: member
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let removeReceipt = await provider.Chain.receipt(removeCall);

    // check if member was removed from committee
    response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(false));
});

it("can be paused and unpaused", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // pause contract
    let pauseCall = await provider.Contract.call(
        contract,
        "pause",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let pauseReceipt = await provider.Chain.receipt(pauseCall);

    // check if contract is paused
    let data = {
        "method": "contract_estimateCall",
        "params": [
          {
            "contract": contract,
            "method": "isPaused",
            "args": []
          }
        ],
        "id": 1,
        "key": ""
    }
    let response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(true));

    // unpause contract
    let unpauseCall = await provider.Contract.call(
        contract,
        "unpause",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let unpauseReceipt = await provider.Chain.receipt(unpauseCall);

    // check if contract is unpaused
    response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(false));
})

it("can pay oracle fee", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // deploy mock oracle
    let oracle = await deployOracle(1723281497, 1000, 1000, 0, contract);
    await provider.Chain.generateBlocks(1);
    let oracleAddress = (await provider.Chain.receipt(oracle.result)).contract;

    // deposit to the contract
    let call = await provider.Contract.call(
        contract,
        "deposit",
        "150",
        "9999",
        []
    );

    await provider.Contract.call(
        contract,
        "deposit",
        "50",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: "0x7F06C13aE7446c8a397Ab8448Ae408c4BE80448f"
            }
        ]
    );

    await provider.Chain.generateBlocks(1);
    let transferReceipt = await provider.Chain.receipt(call)
    expect(transferReceipt.success).toBe(true)

    // propose the oracle to the smart contract
    let proposeCall = await provider.Contract.call(
        contract,
        "proposeOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: oracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    
    await provider.Contract.call(
        contract,
        "approveOracle",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: oracleAddress
            }
        ]
    );

    await provider.Chain.generateBlocks(1);
    let receipt = await provider.Chain.receipt(proposeCall);
    
    // check if it was proposed successfully
    let hasResult = false;
    if ((await isOracleProposed(contract, oracleAddress)).result)
        hasResult = true;
    expect(hasResult).toBe(true);
    
    // fs.writeFileSync("output.json", JSON.stringify(receipt));

    // check if loan fee appears as not paid
    let data = {
        "method": "contract_estimateCall",
        "params": [
          {
            "contract": contract,
            "method": "isFeePaid",
            "args": [
                {
                    "index": 0,
                    "format": "hex",
                    "value": oracleAddress
                }
            ]
          }
        ],
        "id": 1,
        "key": ""
    }
    let response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(false));

    // pay loan fee
    let payCall = await provider.Contract.call(
        contract,
        "payOracleFee",
        "100",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: oracleAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let payReceipt = await provider.Chain.receipt(payCall);
    // console.log(payReceipt.events)
    expect(payReceipt.success).toBe(true);

    // check if loan fee appears as paid
    response = await rpcCall(data);
    expect(response.result.actionResult.outputData).toBe(boolToHexString(true));

    // check if the deposit increased
    let checkBal1Data = {
        "method": "contract_estimateCall",
        "params": [
          {
            "contract": contract,
            "method": "getBalance",
            "args": [
                {
                    "index": 0,
                    "format": "hex",
                    "value": contractRunnerAddress
                }
            ]
          }
        ],
        "id": 1,
        "key": ""
    }
    let checkBal2Data = {
        "method": "contract_estimateCall",
        "params": [
          {
            "contract": contract,
            "method": "getBalance",
            "args": [
                {
                    "index": 0,
                    "format": "hex",
                    "value": "0x7F06C13aE7446c8a397Ab8448Ae408c4BE80448f"
                }
            ]
          }
        ],
        "id": 1,
        "key": ""
    }
    let checkBal1Response = await rpcCall(checkBal1Data);
    let checkBal2Response = await rpcCall(checkBal2Data);
    expect(parseInt(checkBal1Response.result.actionResult.outputData, 16)).toBe(225000000000000000000);
    expect(parseInt(checkBal2Response.result.actionResult.outputData, 16)).toBe(75000000000000000000);
});

it("can change fee rate", async() => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    // check feeRate
    let checkFeeRateCall = await provider.Contract.call(
        contract,
        "getFeeRate",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let checkFeeRateReceipt = await provider.Chain.receipt(checkFeeRateCall);
    expect(checkFeeRateReceipt.actionResult.outputData).toBe("0x05");

    let changeFeeRateCall = await provider.Contract.call(
        contract,
        "changeFeeRate",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: "0x0c"                           // decimal 12
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let changeFeeRateReceipt = await provider.Chain.receipt(changeFeeRateCall);
    expect(changeFeeRateReceipt.success).toBe(true);

    let checkFeeRateChangeCall = await provider.Contract.call(
        contract,
        "getFeeRate",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let checkFeeRateChangeReceipt = await provider.Chain.receipt(checkFeeRateChangeCall);
    expect(checkFeeRateChangeReceipt.actionResult.outputData).toBe("0x0c");
});

it("can change committee president", async () => {
    let {provider, contract} = await deployContract();
    await provider.Chain.generateBlocks(1);

    let newPresident = "0x7F06C13aE7446c8a397Ab8448Ae408c4BE80448f".toLowerCase();

    // check current president
    let checkPresidentCall = await provider.Contract.call(
        contract,
        "getCommitteePresident",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let checkPresidentReceipt = await provider.Chain.receipt(checkPresidentCall);
    expect(checkPresidentReceipt.actionResult.outputData).toBe(contractRunnerAddress.toLowerCase());

    // change president
    let changePresidentCall = await provider.Contract.call(
        contract,
        "changeCommitteePresident",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: newPresident
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let changePresidentReceipt = await provider.Chain.receipt(changePresidentCall);
    expect(changePresidentReceipt.success).toBe(true);

    // check new president
    let checkNewPresidentCall = await provider.Contract.call(
        contract,
        "getCommitteePresident",
        "0",
        "9999",
        []
    );
    await provider.Chain.generateBlocks(1);
    let checkNewPresidentReceipt = await provider.Chain.receipt(checkNewPresidentCall);
    expect(checkNewPresidentReceipt.actionResult.outputData).toBe(newPresident);

    // check if reviewCommittee was updated
    let isCommitteeMember = await provider.Contract.call(
        contract,
        "isCommitteeMember",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: contractRunnerAddress
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let isCommitteeMemberReceipt = await provider.Chain.receipt(isCommitteeMember);
    expect(isCommitteeMemberReceipt.actionResult.outputData).toBe(boolToHexString(false));

    let isCommitteeMember2 = await provider.Contract.call(
        contract,
        "isCommitteeMember",
        "0",
        "9999",
        [
            {
                index: 0,
                format: ContractArgumentFormat.Hex,
                value: newPresident
            }
        ]
    );
    await provider.Chain.generateBlocks(1);
    let isCommitteeMemberReceipt2 = await provider.Chain.receipt(isCommitteeMember2);
    expect(isCommitteeMemberReceipt2.actionResult.outputData).toBe(boolToHexString(true));
});
