export function diffElements(prevElements, nextElements){
    const allIdSet = new Set()
    const prevElementMap = new Map()
    const nextElementMap = new Map()

    const toAddElement = []
    const toDeleteElement = []
    const toUpdateElement = []

    for(const element of prevElements){
        allIdSet.add(element.id)
        prevElementMap.set(element.id,element)
    }

    for(const element of nextElements){
        allIdSet.add(element.id)
        nextElementMap.set(element.id,element)
    }

    for(const id of allIdSet){
        const prevEl = prevElementMap.get(id)
        const nextEl = nextElementMap.get(id)

        if(!prevEl && nextEl){
            // New element
            toAddElement.push(nextEl)
        }
        else if(prevEl && !nextEl){
            // Element is deleted
            toDeleteElement.push(prevEl)
        }
        else if(prevEl && nextEl){
            //Update element
            toUpdateElement.push({
                prev: prevEl,
                next: nextEl
            })
        }
    }
    return {toAddElement,toDeleteElement,toUpdateElement}
}