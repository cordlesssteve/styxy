describe('Port Test B', () => {
  it('should run test B with allocated port', () => {
    // This test will trigger Styxy port allocation
    cy.log('Running Port Test B')

    // Simulate a longer-running test to overlap with other instances
    cy.wait(3000)

    // Verify we can access basic functionality
    cy.visit('about:blank')
    cy.title().should('exist')

    cy.log('Port Test B completed')
  })
})