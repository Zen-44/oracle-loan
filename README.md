# Oracle Loan Smart Contract

This smart contract enables iDNA loans for running oracle votes on the Idena Blockchain.

### Web UI
https://github.com/Zen-44/oracle-loan-ui    

### Key Principles
- anyone can deposit funds in the contract which are used to hand out loans
- a fee is collected for every loan and the fees are distributed to all depositors according to their share of the fund pool
- anyone can propose an oracle (as long as it follows some technical rules)
- for an oracle to get funded it also needs to be approved by the review committee (to avoid extreme cases and have better control over the system)

### Oracle Vote Requirements
For an oracle to be considered valid, it needs to:
- have the correct refund address
- have no owner fee set
- start within 2 weeks (from the moment it is proposed)
- last less than ~4 weeks once started (120960 blocks)

### Other Considerations
- funding oracles can be paused by the committee president (other operations can not be paused, e.g. withdrawals)
- the committee president can withdraw untracked balance (to avoid stuck funds)
- if a withdrawal exceeds the available balance of the contract, it will need to wait for enough loans to be returned
- the committee president may designate and dismiss the review committee members
