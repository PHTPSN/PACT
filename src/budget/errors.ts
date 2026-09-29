export class BudgetValidationError extends Error {
  override readonly name = 'BudgetValidationError'
}

export class BudgetProposalNotFoundError extends Error {
  override readonly name = 'BudgetProposalNotFoundError'
}

export class BudgetApprovalError extends Error {
  override readonly name = 'BudgetApprovalError'
}

export class BudgetExecutionError extends Error {
  override readonly name = 'BudgetExecutionError'
}
