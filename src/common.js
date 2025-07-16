/**
 *
 * @param {any} prevElements
 * @param {any} nextElements
 * @returns
 */
export const diffElements = (prevElements = [], nextElements = []) => {
  const toDeleteElements = [];
  const toUpdateElements = [];
  const toAddElements = [];

  // Filter out hidden elements
  const visiblePrevElements = prevElements.filter((el) => !el.hidden);
  const visibleNextElements = nextElements.filter((el) => !el.hidden);

  for (const prevElement of visiblePrevElements) {
    const nextElement = visibleNextElements.find(
      (element) =>
        element.id === prevElement.id && element.type === prevElement.type,
    );
    if (!nextElement) {
      toDeleteElements.push(prevElement);
    } else {
      toUpdateElements.push({
        prev: prevElement,
        next: nextElement,
      });
    }
  }

  for (const nextElement of visibleNextElements) {
    const prevElement = visiblePrevElements.find(
      (element) =>
        element.id === nextElement.id && element.type === nextElement.type,
    );
    if (!prevElement) {
      toAddElements.push(nextElement);
    }
  }

  // Add elements that became hidden to delete list
  for (const prevElement of prevElements) {
    const nextElement = nextElements.find(
      (el) => el.id === prevElement.id && el.type === prevElement.type,
    );
    if (nextElement && nextElement.hidden && !prevElement.hidden) {
      toDeleteElements.push(prevElement);
    }
  }

  // console.log({
  //   toDeleteElements, toUpdateElements, toAddElements
  // })

  return { toDeleteElements, toUpdateElements, toAddElements };
};
