describe('Port Test A', () => {
  it('should run test A with allocated port', () => {
    // This test will trigger Styxy port allocation
    cy.log('Running Port Test A')

    // Simulate a longer-running test to overlap with other instances
    cy.wait(2000)

    // Verify we can access basic functionality
    cy.visit('about:blank')
    cy.title().should('exist')

    cy.log('Port Test A completed')
  })
})