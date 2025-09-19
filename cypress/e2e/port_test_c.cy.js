describe('Port Test C', () => {
  it('should run test C with allocated port', () => {
    // This test will trigger Styxy port allocation
    cy.log('Running Port Test C')

    // Simulate a longer-running test to overlap with other instances
    cy.wait(2500)

    // Verify we can access basic functionality
    cy.visit('about:blank')
    cy.title().should('exist')

    cy.log('Port Test C completed')
  })
})